-- Saran Chess Academy Ops — PostgreSQL schema
-- Railway: attach Postgres plugin, set DATABASE_URL, then run migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT UNIQUE NOT NULL,
  student_name TEXT,
  parent_name TEXT,
  phone_e164 TEXT,
  email TEXT,
  country_code TEXT,
  inferred_timezone TEXT,
  child_age INT,
  source TEXT DEFAULT 'website',
  status TEXT DEFAULT 'new',
  lead_score INT DEFAULT 0,
  assigned_did TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT REFERENCES leads(lead_id),
  tier TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  cohort_id UUID,
  stripe_session_id TEXT,
  amount_cents INT,
  currency TEXT DEFAULT 'usd',
  started_at TIMESTAMPTZ,
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  skill_level TEXT NOT NULL,
  timezone TEXT NOT NULL,
  max_students INT DEFAULT 5,
  current_count INT DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  campaign_id TEXT,
  creative_id TEXT,
  spend_cents INT DEFAULT 0,
  clicks INT DEFAULT 0,
  leads INT DEFAULT 0,
  cpc_cents INT,
  cpl_cents INT,
  recorded_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  lead_id TEXT,
  delegated_agent TEXT,
  action_code TEXT,
  payload JSONB,
  crm_audit_log TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  virtual_number_did TEXT,
  execute_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'queued',
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_e164);
CREATE INDEX IF NOT EXISTS idx_call_queue_execute ON call_queue(execute_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_cohorts_open ON cohorts(status, skill_level, timezone);
