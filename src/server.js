require("dotenv").config();
const path = require("path");
const express = require("express");
const { route } = require("./orchestrator");
const db = require("./db");
const { sendMessage, messagingStatus, triggerVapiCall } = require("./integrations");

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
  });
});

app.get("/admin/memory", auth, (_req, res) => {
  if (db.usePg()) return res.json({ note: "Using Postgres — query tables directly" });
  res.json(db.memorySnapshot());
});

async function processEvent(eventType, body, res) {
  const decision = route(eventType, body || {});
  const internal = decision._internal || {};
  delete decision._internal;

  if (process.env.TELEGRAM_BOT_TOKEN && decision.client_communication?.message_content) {
    decision.client_communication.channel = "TELEGRAM";
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

    if (decision.client_communication?.message_content) {
      await sendMessage({
        phone: decision.client_communication.recipient_e164 || internal.phone_e164,
        telegramChatId: body.telegram_chat_id || internal.telegram_chat_id || null,
        text: decision.client_communication.message_content,
        alsoAdmin: true,
      });
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
