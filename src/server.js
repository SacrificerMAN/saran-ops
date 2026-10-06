require("dotenv").config();
const path = require("path");
const express = require("express");
const { route } = require("./orchestrator");
const db = require("./db");
const {
  sendMessage,
  sendTelegram,
  messagingStatus,
  telegramConfig,
  triggerVapiCall,
} = require("./integrations");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 8080;
const SECRET = process.env.WEBHOOK_SECRET || "";

function auth(req, res, next) {
  if (!SECRET) return next();
  const h = req.headers["x-webhook-secret"] || req.query.secret;
  if (h !== SECRET) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/api", (_req, res) => {
  res.json({
    service: "saran-ops",
    academy: "Saran Chess Academy",
    status: "ok",
    db: db.usePg() ? "postgres" : "memory",
    messaging: messagingStatus(),
    agents: [
      "AGENT_1_AD_OPS",
      "AGENT_2_LEAD_QUAL",
      "AGENT_3_VOICE_SALES",
      "AGENT_4_DEMO_OPS",
      "AGENT_5_BATCH_RETENTION",
    ],
    endpoints: [
      "POST /webhook/lead",
      "POST /webhook/voice",
      "POST /webhook/coach",
      "POST /webhook/payment",
      "POST /webhook/renewal",
      "POST /webhook/ads",
      "POST /orchestrate",
      "GET /health",
      "GET /admin/memory",
      "GET /api",
    ],
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    db: db.usePg() ? "postgres" : "memory",
    messaging: messagingStatus(),
    telegram: telegramConfig(),
    webhook_secret_required: Boolean(SECRET),
  });
});

app.get("/admin/memory", auth, (_req, res) => {
  if (db.usePg()) return res.json({ note: "Using Postgres — query tables directly" });
  res.json(db.memorySnapshot());
});

app.post("/admin/test-telegram", auth, async (req, res) => {
  const cfg = telegramConfig();
  if (!cfg.bot_token_set) {
    return res.status(400).json({
      ok: false,
      error: "TELEGRAM_BOT_TOKEN not set on Railway",
    });
  }
  const chatId = req.body.chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    return res.status(400).json({
      ok: false,
      error: "TELEGRAM_ADMIN_CHAT_ID not set. Add it in Railway Variables, or pass chat_id in body.",
      hint: "Message your bot /start then open https://api.telegram.org/bot<TOKEN>/getUpdates and copy message.chat.id",
    });
  }
  const result = await sendTelegram(
    chatId,
    req.body.text ||
      "Saran Ops test message — Telegram is connected.\nTime: " + new Date().toISOString()
  );
  res.json({
    ok: result.ok,
    chat_id_used: String(chatId),
    telegram_response: result.data || null,
    stub: result.stub || false,
  });
});

async function processEvent(eventType, body, res) {
  const decision = route(eventType, body || {});
  const internal = decision._internal || {};
  delete decision._internal;

  if (process.env.TELEGRAM_BOT_TOKEN && decision.client_communication?.message_content) {
    decision.client_communication.channel = "TELEGRAM";
  }

  // Always notify Telegram FIRST (even if DB fails later)
  try {
    let text = decision.client_communication?.message_content || null;

    if (eventType.includes("NEW_LEAD") || eventType === "EVENT_NEW_LEAD") {
      text = [
        "NEW LEAD — Saran Chess Academy",
        `ID: ${decision.lead_metadata?.lead_id || "—"}`,
        `Parent: ${decision.lead_metadata?.parent_name || "—"}`,
        `Student: ${decision.lead_metadata?.student_name || "—"}`,
        `Phone: ${internal.phone_e164 || "—"}`,
        `Age: ${internal.child_age ?? "—"}`,
        `Geo: ${decision.lead_metadata?.country_code || "—"} · ${decision.lead_metadata?.inferred_timezone || "—"}`,
        `Score: ${internal.lead_score ?? "—"} · ${decision.database_mutation?.status || ""}`,
        `Action: ${decision.operational_action?.action_code || "—"}`,
        decision.operational_action?.execute_immediately
          ? "Call: NOW"
          : `Call: scheduled ${decision.operational_action?.scheduled_time_utc || "—"}`,
      ].join("\n");
      decision.client_communication = decision.client_communication || {};
      decision.client_communication.channel = "TELEGRAM";
      decision.client_communication.message_content = text;
    }

    if (text) {
      const msgResult = await sendMessage({
        phone: decision.client_communication?.recipient_e164 || internal.phone_e164,
        telegramChatId: body.telegram_chat_id || internal.telegram_chat_id || null,
        text,
        alsoAdmin: true,
      });
      decision._messaging = {
        ok: msgResult?.ok || false,
        stub: msgResult?.stub || false,
        results: (msgResult?.results || []).map((r) => ({
          ok: r.ok,
          channel: r.channel,
          error: r.data?.description || null,
        })),
      };
    }
  } catch (msgErr) {
    console.error("messaging error", msgErr);
    decision._messaging = { ok: false, error: String(msgErr.message || msgErr) };
  }

  try {
    await db.audit(eventType, decision);

    if (eventType.includes("NEW_LEAD") || eventType === "EVENT_NEW_LEAD") {
      await db.saveLead({
        lead_id: decision.lead_metadata.lead_id,
        student_name: decision.lead_metadata.student_name,
        parent_name: decision.lead_metadata.parent_name,
        phone_e164: internal.phone_e164,
        email: internal.email,
        country_code: decision.lead_metadata.country_code,
        inferred_timezone: decision.lead_metadata.inferred_timezone,
        child_age: internal.child_age,
        source: internal.source,
        status: decision.database_mutation.status,
        lead_score: internal.lead_score,
        assigned_did: decision.operational_action.virtual_number_did,
      });

      if (
        decision.operational_action.action_code === "QUEUE_DELAYED_CALL" &&
        decision.operational_action.scheduled_time_utc &&
        internal.phone_e164
      ) {
        await db.enqueueCall(
          decision.lead_metadata.lead_id,
          internal.phone_e164,
          decision.operational_action.virtual_number_did,
          decision.operational_action.scheduled_time_utc
        );
      }

      if (
        decision.operational_action.execute_immediately &&
        decision.operational_action.action_code === "TRIGGER_OUTBOUND_CALL" &&
        internal.phone_e164
      ) {
        await triggerVapiCall({
          phone: internal.phone_e164,
          did: decision.operational_action.virtual_number_did,
          leadId: decision.lead_metadata.lead_id,
          studentName: decision.lead_metadata.student_name,
          parentName: decision.lead_metadata.parent_name,
        });
      }
    }

    if (decision.database_mutation?.status && decision.lead_metadata?.lead_id) {
      if (!eventType.includes("NEW_LEAD")) {
        await db.updateLeadStatus(
          decision.lead_metadata.lead_id,
          decision.database_mutation.status
        );
      }
    }

    if (eventType.includes("PAYMENT") && internal.is_group) {
      const { cohort, created } = await db.findOrCreateCohort(
        internal.skill_level || "beginner",
        internal.timezone || "UTC"
      );
      await db.addToCohort(cohort.id);
      await db.saveEnrollment({
        lead_id: decision.lead_metadata.lead_id,
        tier: "group",
        status: "enrolled_group",
        cohort_id: cohort.id,
      });
      decision.database_mutation.crm_audit_log += created
        ? ` | CREATE_NEW_COHORT ${cohort.id || cohort.name}`
        : ` | ADD_TO_COHORT ${cohort.id || cohort.name}`;
    }
  } catch (err) {
    console.error("processEvent error", err);
    decision._error = String(err.message || err);
  }

  res.json(decision);
}

app.post("/orchestrate", auth, (req, res) => {
  const eventType = req.body.event_type || req.body.event || "EVENT_NEW_LEAD";
  processEvent(eventType, req.body, res);
});

app.post("/webhook/lead", auth, (req, res) => processEvent("EVENT_NEW_LEAD", req.body, res));
app.post("/webhook/voice", auth, (req, res) => processEvent("EVENT_VOICE_OUTCOME", req.body, res));
app.post("/webhook/coach", auth, (req, res) => processEvent("EVENT_COACH_FEEDBACK", req.body, res));
app.post("/webhook/payment", auth, (req, res) =>
  processEvent("EVENT_PAYMENT_SUCCESS", req.body, res)
);
app.post("/webhook/renewal", auth, (req, res) =>
  processEvent("EVENT_MONTHLY_RENEWAL", req.body, res)
);
app.post("/webhook/ads", auth, (req, res) => processEvent("EVENT_AD_OPS", req.body, res));

app.listen(PORT, () => {
  console.log(
    `saran-ops listening on :${PORT} db=${db.usePg() ? "postgres" : "memory"} msg=${messagingStatus()}`
  );
});
