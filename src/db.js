/**
 * Postgres when DATABASE_URL is set; otherwise in-memory store for local/demo.
 */

const { Pool } = require("pg");

let pool = null;
const mem = {
  leads: new Map(),
  enrollments: [],
  cohorts: [],
  audit: [],
  call_queue: [],
};

function usePg() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!usePg()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error("No DATABASE_URL");
  return p.query(text, params);
}

async function saveLead(data) {
  if (usePg()) {
    await query(
      `INSERT INTO leads (lead_id, student_name, parent_name, phone_e164, email, country_code, inferred_timezone, child_age, source, status, lead_score, assigned_did)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (lead_id) DO UPDATE SET
         status = EXCLUDED.status,
         lead_score = EXCLUDED.lead_score,
         assigned_did = EXCLUDED.assigned_did,
         updated_at = NOW()`,
      [
        data.lead_id,
        data.student_name,
        data.parent_name,
        data.phone_e164,
        data.email,
        data.country_code,
        data.inferred_timezone,
        data.child_age,
        data.source || "website",
        data.status,
        data.lead_score || 0,
        data.assigned_did,
      ]
    );
  } else {
    mem.leads.set(data.lead_id, { ...data, updated_at: new Date().toISOString() });
  }
}

async function updateLeadStatus(leadId, status) {
  if (usePg()) {
    await query(`UPDATE leads SET status = $2, updated_at = NOW() WHERE lead_id = $1`, [leadId, status]);
  } else if (mem.leads.has(leadId)) {
    mem.leads.get(leadId).status = status;
  }
}

async function audit(eventType, decision) {
  const row = {
    event_type: eventType,
    lead_id: decision.lead_metadata?.lead_id,
    delegated_agent: decision.delegated_agent,
    action_code: decision.operational_action?.action_code,
    payload: decision,
    crm_audit_log: decision.database_mutation?.crm_audit_log,
    created_at: new Date().toISOString(),
  };
  if (usePg()) {
    await query(
      `INSERT INTO audit_log (event_type, lead_id, delegated_agent, action_code, payload, crm_audit_log)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.event_type, row.lead_id, row.delegated_agent, row.action_code, JSON.stringify(row.payload), row.crm_audit_log]
    );
  } else {
    mem.audit.push(row);
  }
}

async function enqueueCall(leadId, phone, did, executeAt) {
  if (usePg()) {
    await query(
      `INSERT INTO call_queue (lead_id, phone_e164, virtual_number_did, execute_at, status)
       VALUES ($1,$2,$3,$4,'queued')`,
      [leadId, phone, did, executeAt]
    );
  } else {
    mem.call_queue.push({
      lead_id: leadId,
      phone_e164: phone,
      virtual_number_did: did,
      execute_at: executeAt,
      status: "queued",
    });
  }
}

async function findOrCreateCohort(skillLevel, timezone) {
  if (usePg()) {
    const { rows } = await query(
      `SELECT * FROM cohorts
       WHERE status = 'open' AND skill_level = $1 AND timezone = $2 AND current_count < max_students
       ORDER BY created_at ASC LIMIT 1`,
      [skillLevel, timezone]
    );
    if (rows[0]) return { cohort: rows[0], created: false };
    const name = `${skillLevel}-${timezone}-${Date.now().toString(36).slice(-4)}`;
    const ins = await query(
      `INSERT INTO cohorts (name, skill_level, timezone, max_students, current_count, status)
       VALUES ($1,$2,$3,5,0,'open') RETURNING *`,
      [name, skillLevel, timezone]
    );
    return { cohort: ins.rows[0], created: true };
  }
  let c = mem.cohorts.find(
    (x) => x.status === "open" && x.skill_level === skillLevel && x.timezone === timezone && x.current_count < 5
  );
  if (c) return { cohort: c, created: false };
  c = {
    id: `C-${Date.now()}`,
    name: `${skillLevel}-${timezone}`,
    skill_level: skillLevel,
    timezone,
    max_students: 5,
    current_count: 0,
    status: "open",
  };
  mem.cohorts.push(c);
  return { cohort: c, created: true };
}

async function addToCohort(cohortId) {
  if (usePg()) {
    await query(
      `UPDATE cohorts SET current_count = current_count + 1,
        status = CASE WHEN current_count + 1 >= max_students THEN 'full' ELSE status END
       WHERE id = $1`,
      [cohortId]
    );
  } else {
    const c = mem.cohorts.find((x) => x.id === cohortId);
    if (c) {
      c.current_count += 1;
      if (c.current_count >= 5) c.status = "full";
    }
  }
}

async function saveEnrollment(data) {
  if (usePg()) {
    await query(
      `INSERT INTO enrollments (lead_id, tier, status, cohort_id, amount_cents, currency)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [data.lead_id, data.tier, data.status, data.cohort_id || null, data.amount_cents || null, data.currency || "usd"]
    );
  } else {
    mem.enrollments.push(data);
  }
}

function memorySnapshot() {
  return {
    leads: [...mem.leads.values()],
    enrollments: mem.enrollments,
    cohorts: mem.cohorts,
    audit: mem.audit.slice(-50),
    call_queue: mem.call_queue,
  };
}

module.exports = {
  usePg,
  getPool,
  query,
  saveLead,
  updateLeadStatus,
  audit,
  enqueueCall,
  findOrCreateCohort,
  addToCohort,
  saveEnrollment,
  memorySnapshot,
};
