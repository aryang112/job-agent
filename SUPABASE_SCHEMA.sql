-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)

create table if not exists jobs (
  id text primary key,
  title text not null,
  company text not null,
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
  status text default 'new',  -- new | applied | skipped | interviewing
  search_query text,
  found_at timestamptz default now(),
  applied_at timestamptz,
  notes text
);

-- Index for fast dashboard queries
create index if not exists jobs_status_idx on jobs(status);
create index if not exists jobs_score_idx on jobs(score desc);
create index if not exists jobs_found_at_idx on jobs(found_at desc);

-- Scan log so you can see history
create table if not exists scan_log (
  id serial primary key,
  ran_at timestamptz default now(),
  jobs_found integer,
  jobs_new integer,
  queries_run jsonb
);
