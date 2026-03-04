-- Job Agent — Full Database Schema
-- Run this in Supabase SQL Editor (supabase.com → project → SQL Editor)

-- ============================================
-- Jobs table
-- ============================================
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  title text NOT NULL,
  company text NOT NULL,
  location text,
  salary text,
  url text,
  description text,
  score integer,
  verdict text,
  match_reasons jsonb,
  gaps jsonb,
  key_requirements jsonb,
  salary_estimate text,
  quick_pitch text,
  apply_recommendation text,
  status text DEFAULT 'new',  -- new | queued_to_apply | applied | failed | manual_required | no_response | screening | interviewing | offer | rejected | withdrawn
  search_query text,
  found_at timestamptz DEFAULT now(),
  applied_at timestamptz,
  notes text,
  -- Phase 1+ columns
  is_federal boolean DEFAULT false,
  is_defense_prime boolean DEFAULT false,
  clearance_mentioned boolean DEFAULT false,
  ats_type text,  -- easy_apply | workday | greenhouse | lever | icims | taleo | custom | unknown
  queued_at timestamptz,
  agent_log text,
  user_notes text,
  retry_count integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_score_idx ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS jobs_found_at_idx ON jobs(found_at DESC);
CREATE INDEX IF NOT EXISTS jobs_queued_at_idx ON jobs(queued_at) WHERE queued_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_is_federal_idx ON jobs(is_federal) WHERE is_federal = true;
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company);

-- ============================================
-- Scan log
-- ============================================
CREATE TABLE IF NOT EXISTS scan_log (
  id serial PRIMARY KEY,
  ran_at timestamptz DEFAULT now(),
  jobs_found integer,
  jobs_new integer,
  queries_run jsonb,
  jobs_queued integer DEFAULT 0
);

-- ============================================
-- Application log (agent submission tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS application_log (
  id serial PRIMARY KEY,
  job_id text REFERENCES jobs(id) ON DELETE CASCADE,
  attempted_at timestamptz DEFAULT now(),
  success boolean DEFAULT false,
  ats_type text,
  failure_reason text,
  pages_navigated integer DEFAULT 0,
  fields_filled integer DEFAULT 0,
  resume_uploaded boolean DEFAULT false
);

-- ============================================
-- Notes bank (ATS answer stories)
-- ============================================
CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  category text NOT NULL,
  title text NOT NULL,
  story text NOT NULL,
  keywords text[] DEFAULT '{}',
  last_used timestamptz,
  created_at timestamptz DEFAULT now()
);
