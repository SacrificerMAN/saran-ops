/**
 * Master Multi-Agent Orchestrator — deterministic routing
 * Implements the 5-agent decision matrix for Saran Chess Academy
 */

const crypto = require("crypto");
const {
  parseCountryCode,
  getGeo,
  callingWindow,
  qualifyLead,
} = require("./timezone");

function uuidv4() {
  return crypto.randomUUID();
}

const PRICING = {
  group: { min: 60, max: 80, label: "Small Group Cohort (max 5)" },
  one_on_one: { min: 120, max: 150, label: "1-on-1 Personalized Coaching" },
  fide: { min: 160, max: 200, label: "FIDE Rating Masterclass" },
};

function basePayload(overrides = {}) {
  return {
    delegated_agent: null,
    lead_metadata: {
      lead_id: null,
      student_name: null,
      parent_name: null,
      country_code: null,
      inferred_timezone: null,
    },
    operational_action: {
      action_code: null,
      execute_immediately: false,
      scheduled_time_utc: null,
      virtual_number_did: null,
    },
    database_mutation: {
      target_table: "leads",
      status: "qualified",
      crm_audit_log: "",
    },
    client_communication: {
      channel: "NONE",
      recipient_e164: null,
      message_content: null,
    },
    ...overrides,
  };
}

function handleNewLead(body) {
  const leadId = body.lead_id || `L-${uuidv4().slice(0, 8).toUpperCase()}`;
  const phone = body.phone || body.phone_e164 || body.whatsapp || "";
  const countryCode =
    body.country_code || parseCountryCode(phone) || parseCountryCode(body.dial_code);
  const geo = getGeo(countryCode);
  const tz = body.timezone || (geo && geo.timezone) || null;
  const window = callingWindow(tz);
  const qual = qualifyLead({ childAge: body.child_age || body.age, countryCode });

  const out = basePayload({
    delegated_agent: "AGENT_2_LEAD_QUAL",
    lead_metadata: {
      lead_id: leadId,
      student_name: body.student_name || body.child_name || null,
      parent_name: body.parent_name || body.name || null,
      country_code: countryCode,
      inferred_timezone: tz,
    },
    operational_action: {
      action_code: window.execute_immediately ? "TRIGGER_OUTBOUND_CALL" : "QUEUE_DELAYED_CALL",
      execute_immediately: qual.qualified && window.execute_immediately,
      scheduled_time_utc: window.scheduled_time_utc,
      virtual_number_did: geo ? geo.did : null,
    },
    database_mutation: {
      target_table: "leads",
      status: qual.qualified ? "qualified" : "disqualified",
      crm_audit_log: `NEW_LEAD score=${qual.score} geo=${countryCode || "?"} tz=${tz || "?"} window=${window.execute_immediately ? "NOW" : "DELAYED"}`,
    },
    client_communication: {
      channel: phone ? "WHATSAPP" : "NONE",
      recipient_e164: phone || null,
      message_content: phone
        ? `Hi${body.parent_name ? " " + body.parent_name : ""}! Thanks for reaching out to Saran Chess Academy. Our coach will connect with you shortly for a free 30-minute skills evaluation. — Saran Chess Academy`
        : null,
    },
    _internal: {
      lead_score: qual.score,
      qualified: qual.qualified,
      phone_e164: phone,
      child_age: body.child_age || body.age || null,
      email: body.email || null,
      source: body.source || "website",
    },
  });

  if (!qual.qualified) {
    out.operational_action.action_code = "SEND_WHATSAPP_ASSESSMENT";
    out.operational_action.execute_immediately = false;
    out.client_communication.message_content =
      "Thank you for your interest in Saran Chess Academy. A team member will review your details and follow up on WhatsApp.";
  }

  return out;
}

function handleVoiceOutcome(body) {
  const status = (body.outcome || body.status || "").toUpperCase();
  const leadId = body.lead_id;
  const phone = body.phone_e164 || body.phone || null;

  const out = basePayload({
    delegated_agent: "AGENT_3_VOICE_SALES",
    lead_metadata: {
      lead_id: leadId,
      student_name: body.student_name || null,
      parent_name: body.parent_name || null,
      country_code: body.country_code || null,
      inferred_timezone: body.inferred_timezone || null,
    },
  });

  if (status === "DEMO_CONFIRMED" || status === "DEMO_BOOKED") {
    out.operational_action.action_code = "SEND_WHATSAPP_ASSESSMENT";
    out.operational_action.execute_immediately = true;
    out.database_mutation = {
      target_table: "leads",
      status: "demo_booked",
      crm_audit_log: `DEMO_BOOKED lead=${leadId}`,
    };
    out.client_communication = {
      channel: "WHATSAPP",
      recipient_e164: phone,
      message_content: `Your free 30-minute chess skills evaluation is confirmed. You'll receive a calendar invite shortly. Please join on time — Coach Mohit (FIDE 1952) will assess level and recommend the best track. — Saran Chess Academy`,
    };
  } else if (status === "PRICE_OBJECTION" || status === "PRICE_OBJECTION_DOWNSELL") {
    out.operational_action.action_code = "SEND_WHATSAPP_ASSESSMENT";
    out.operational_action.execute_immediately = true;
    out.database_mutation = {
      target_table: "leads",
      status: "qualified",
      crm_audit_log: `PRICE_OBJECTION → downsell group cohort lead=${leadId}`,
    };
    out.client_communication = {
      channel: "WHATSAPP",
      recipient_e164: phone,
      message_content: `We also offer Small Group Cohorts (max 5 students) at $60–$80/month for 8 sessions — same coach quality, shared batch by level & timezone. Reply YES for group details or stick with 1-on-1. — Saran Chess Academy`,
    };
  } else {
    out.operational_action.action_code = "SEND_WHATSAPP_ASSESSMENT";
    out.operational_action.execute_immediately = true;
    out.database_mutation = {
      target_table: "leads",
      status: "qualified",
      crm_audit_log: `CALL_UNANSWERED drip lead=${leadId}`,
    };
    out.client_communication = {
      channel: "WHATSAPP",
      recipient_e164: phone,
      message_content: `Hi! We tried reaching you about a free 30-minute chess demo with our FIDE coach. Reply with a good time (or YES) and we'll schedule it. — Saran Chess Academy`,
    };
  }

  return out;
}

function handleCoachFeedback(body) {
  const tier = (body.recommended_track || body.tier || "one_on_one").toLowerCase();
  const map = {
    group: PRICING.group,
    "1on1": PRICING.one_on_one,
    one_on_one: PRICING.one_on_one,
    "1-on-1": PRICING.one_on_one,
    fide: PRICING.fide,
    masterclass: PRICING.fide,
  };
  const price = map[tier] || PRICING.one_on_one;
  const checkout =
    body.checkout_url ||
    process.env.CHECKOUT_URL_1ON1 ||
    "https://saranchessacademy.com/#join";

  const level = body.level || body.skill_level || "Beginner";
  const interest = body.interest || "High";
  const notes = body.notes || body.coach_notes || "";

  const report = [
    `Parent Assessment — ${body.student_name || "Student"}`,
    `Level: ${level}`,
    `Engagement: ${interest}`,
    `Recommended: ${price.label} ($${price.min}–$${price.max}/mo, 8 sessions)`,
    notes ? `Coach notes: ${notes}` : null,
    `Next step: ${checkout}`,
  ]
    .filter(Boolean)
    .join("\n");

  return basePayload({
    delegated_agent: "AGENT_4_DEMO_OPS",
    lead_metadata: {
      lead_id: body.lead_id,
      student_name: body.student_name || null,
      parent_name: body.parent_name || null,
      country_code: body.country_code || null,
      inferred_timezone: body.inferred_timezone || null,
    },
    operational_action: {
      action_code: "SEND_WHATSAPP_ASSESSMENT",
      execute_immediately: true,
      scheduled_time_utc: null,
      virtual_number_did: null,
    },
    database_mutation: {
      target_table: "leads",
      status: "demo_booked",
      crm_audit_log: `COACH_FEEDBACK tier=${tier} level=${level} lead=${body.lead_id}`,
    },
    client_communication: {
      channel: "WHATSAPP",
      recipient_e164: body.phone_e164 || body.phone || null,
      message_content: report,
    },
  });
}

function handlePaymentSuccess(body) {
  const isGroup = (body.tier || "").toLowerCase().includes("group");
  return basePayload({
    delegated_agent: "AGENT_5_BATCH_RETENTION",
    lead_metadata: {
      lead_id: body.lead_id,
      student_name: body.student_name || null,
      parent_name: body.parent_name || null,
      country_code: body.country_code || null,
      inferred_timezone: body.inferred_timezone || null,
    },
    operational_action: {
      action_code: isGroup ? "PROVISION_COHORT" : "PROCESS_RENEWAL",
      execute_immediately: true,
      scheduled_time_utc: null,
      virtual_number_did: null,
    },
    database_mutation: {
      target_table: "enrollments",
      status: isGroup ? "enrolled_group" : "enrolled_1on1",
      crm_audit_log: `PAYMENT_SUCCESS tier=${body.tier || "?"} lead=${body.lead_id} cohort_cap=5`,
    },
    client_communication: {
      channel: "WHATSAPP",
      recipient_e164: body.phone_e164 || body.phone || null,
      message_content: `Welcome to Saran Chess Academy! Your enrollment is confirmed (${isGroup ? "Group Cohort" : "1-on-1"}). You'll receive class schedule and Lichess study links shortly. — Coach Mohit`,
    },
    _internal: {
      skill_level: body.skill_level || body.level || "beginner",
      timezone: body.inferred_timezone || body.timezone || "UTC",
      is_group: isGroup,
    },
  });
}

function handleMonthlyRenewal(body) {
  const link = body.renewal_url || process.env.RENEWAL_URL || "https://saranchessacademy.com/#join";
  return basePayload({
    delegated_agent: "AGENT_5_BATCH_RETENTION",
    lead_metadata: {
      lead_id: body.lead_id,
      student_name: body.student_name || null,
      parent_name: body.parent_name || null,
      country_code: body.country_code || null,
      inferred_timezone: body.inferred_timezone || null,
    },
    operational_action: {
      action_code: "PROCESS_RENEWAL",
      execute_immediately: true,
      scheduled_time_utc: null,
      virtual_number_did: null,
    },
    database_mutation: {
      target_table: "enrollments",
      status: "renewal_pending",
      crm_audit_log: `RENEWAL_NOTICE lead=${body.lead_id} rating_delta=${body.rating_gain || "n/a"}`,
    },
    client_communication: {
      channel: "WHATSAPP",
      recipient_e164: body.phone_e164 || body.phone || null,
      message_content: `Monthly progress for ${body.student_name || "your child"}: rating ${body.rating_gain ? "+" + body.rating_gain : "update inside"}. Renew in 1 click: ${link} — Saran Chess Academy`,
    },
  });
}

function handleAdOps(body) {
  const cpl = body.cpl_cents != null ? body.cpl_cents : body.cpl;
  const action =
    cpl != null && cpl > 3000
      ? "PAUSE_CREATIVE"
      : body.scale
        ? "SCALE_CAMPAIGN"
        : "LOG_METRICS";

  return basePayload({
    delegated_agent: "AGENT_1_AD_OPS",
    lead_metadata: {
      lead_id: body.campaign_id || "ad",
      student_name: null,
      parent_name: null,
      country_code: null,
      inferred_timezone: null,
    },
    operational_action: {
      action_code: action === "LOG_METRICS" ? "SCALE_CAMPAIGN" : action,
      execute_immediately: true,
      scheduled_time_utc: null,
      virtual_number_did: null,
    },
    database_mutation: {
      target_table: "ad_metrics",
      status: "qualified",
      crm_audit_log: `AD_OPS action=${action} cpl=${cpl ?? "n/a"} campaign=${body.campaign_id || "?"}`,
    },
    client_communication: {
      channel: "NONE",
      recipient_e164: null,
      message_content: null,
    },
  });
}

function route(eventType, body) {
  const t = (eventType || body.event_type || "").toUpperCase();
  switch (t) {
    case "EVENT_NEW_LEAD":
    case "NEW_LEAD":
      return handleNewLead(body);
    case "EVENT_VOICE_OUTCOME":
    case "VOICE_OUTCOME":
      return handleVoiceOutcome(body);
    case "EVENT_COACH_FEEDBACK":
    case "COACH_FEEDBACK":
      return handleCoachFeedback(body);
    case "EVENT_PAYMENT_SUCCESS":
    case "PAYMENT_SUCCESS":
      return handlePaymentSuccess(body);
    case "EVENT_MONTHLY_RENEWAL":
    case "MONTHLY_RENEWAL":
      return handleMonthlyRenewal(body);
    case "EVENT_AD_OPS":
    case "AD_OPS":
      return handleAdOps(body);
    default:
      return basePayload({
        delegated_agent: "AGENT_2_LEAD_QUAL",
        database_mutation: {
          target_table: "leads",
          status: "qualified",
          crm_audit_log: `UNKNOWN_EVENT type=${t}`,
        },
      });
  }
}

module.exports = {
  route,
  handleNewLead,
  handleVoiceOutcome,
  handleCoachFeedback,
  handlePaymentSuccess,
  handleMonthlyRenewal,
  handleAdOps,
  PRICING,
};
