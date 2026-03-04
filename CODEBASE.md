# Job Agent — Codebase Knowledge Base

> Single source of truth for agents. Update when architecture changes.
> Last updated: 2026-03-04 (All phases complete)

## Architecture Overview
```
job-agent/                        # Vercel Next.js 14 app
├── app/
│   ├── page.tsx                  # Dashboard UI (~450 lines, single component)
│   ├── layout.tsx                # Root layout (IBM Plex Mono + Space Grotesk fonts)
│   ├── login/page.tsx            # Password login page
│   └── api/
│       ├── auth/route.ts         # POST login, DELETE logout (cookie-based)
│       ├── scan/route.ts         # GET/POST: HTML scrape → Claude scoring → auto-queue
│       ├── jobs/route.ts         # GET (filters/search/sort) / PATCH (11 statuses)
│       ├── stats/route.ts        # GET dashboard metrics (12 stats)
│       ├── notes/
│       │   ├── route.ts          # GET list / POST create
│       │   └── [id]/route.ts     # PATCH update / DELETE
│       └── application-log/
│           └── route.ts          # GET log entries with job join
├── lib/
│   ├── profile.ts                # CANDIDATE, DEFENSE_PRIMES, CLEARANCE_KEYWORDS, SCORING_SYSTEM_PROMPT
│   └── supabase.ts               # supabase (anon) + supabaseAdmin (service role)
├── middleware.ts                  # Cookie auth, exempts /login, /api/auth, /api/scan
├── vercel.json                   # Crons: 8am ET + 2pm ET weekdays
├── SUPABASE_SCHEMA.sql           # Full canonical DB schema
├── migrations/001_upgrade.sql    # Incremental migration for new tables/columns
├── tasks/
│   ├── todo.md                   # Build progress tracker
│   └── lessons.md                # Lessons learned for agents
├── CLAUDE.md                     # Agent instructions
└── windows-agent/                # Python auto-apply agent
    ├── agent.py                  # Main polling loop (5min interval)
    ├── config.json               # Runtime config (gitignored)
    ├── config.example.json       # Template with placeholders
    ├── applicator.py             # Routes to easy_apply or vision_apply
    ├── easy_apply.py             # Indeed Easy Apply Playwright flow
    ├── vision_apply.py           # Claude Vision for Workday/Greenhouse/etc
    ├── ats_detector.py           # URL pattern → ATS type
    ├── field_mapper.py           # Candidate data → form fields
    ├── notes_client.py           # Fetches notes, generates answers via Claude
    ├── supabase_client.py        # All DB read/write ops
    ├── throttle.py               # Rate limiting, daily caps, active hours
    ├── logger.py                 # Console + Supabase logging
    ├── setup_scheduler.bat       # Windows Task Scheduler setup
    ├── requirements.txt          # Python dependencies
    └── README.md                 # Setup instructions
```

## Database Schema (Full — after migration 001)
### jobs table
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Indeed job_id or generated slug |
| title, company, location, salary, url, description | text | Basic job data |
| score | integer | 0-100 (with defense/federal boosts) |
| verdict | text | STRONG FIT / GOOD FIT / WEAK FIT / NO FIT |
| match_reasons, gaps, key_requirements | jsonb | Arrays from Claude scoring |
| salary_estimate, quick_pitch, apply_recommendation | text | Claude analysis |
| status | text | new/queued_to_apply/applied/failed/manual_required/no_response/screening/interviewing/offer/rejected/withdrawn |
| is_federal | boolean | Federal/GovCon role |
| is_defense_prime | boolean | Company in DEFENSE_PRIMES list |
| clearance_mentioned | boolean | Clearance keywords in description |
| ats_type | text | easy_apply/workday/greenhouse/lever/icims/taleo/custom/unknown |
| queued_at | timestamptz | When auto-queued |
| agent_log | text | Agent failure reason |
| user_notes | text | Manual notes from dashboard |
| retry_count | integer | Agent retry attempts |
| search_query, found_at, applied_at, notes | text/timestamptz | Legacy fields |

### application_log table
| Column | Type |
|--------|------|
| id | serial PK |
| job_id | text FK → jobs |
| attempted_at | timestamptz |
| success | boolean |
| ats_type, failure_reason | text |
| pages_navigated, fields_filled | integer |
| resume_uploaded | boolean |

### notes table
| Column | Type |
|--------|------|
| id | serial PK |
| category, title, story | text |
| keywords | text[] |
| last_used | timestamptz |
| created_at | timestamptz |

### scan_log table
| id, ran_at, jobs_found, jobs_new, jobs_queued, queries_run |

## Scan Pipeline
1. Iterate 6 search queries (SDET, QA Engineer, etc.)
2. Scrape Indeed HTML → extract jobs from embedded JSON or Claude fallback
3. Deduplicate by job_id, filter existing
4. Score via Claude (SCORING_SYSTEM_PROMPT with federal rules)
5. Server-side: detect defense prime, federal, clearance keywords
6. Score boosts: defense prime +20 (min 80), federal +15 (min 75), clearance +10
7. Auto-queue: score >= 85 → queued_to_apply; 75+ federal → queued_to_apply
8. Discard below 60, upsert rest with all new fields
9. Log to scan_log with jobs_queued count

## Dashboard
- 6 stat cards: Applied Today, Applied This Week, Total Applied, Active Interviews, Manual Required, Strong Fits Pending
- Active interview orange banner when count > 0
- 5 filter tabs: TO APPLY, APPLIED, INTERVIEWING, MANUAL ACTION, ALL
- Search input + sort dropdown (Score/Date/Company)
- Federal/defense badges on job cards
- Detail panel: status dropdown (11 options), user notes textarea, ATS type, clearance badge, application log timeline
- Notes Bank modal (CRUD)
- Manual Action section with pre-filled checklist

## Windows Agent Loop
1. Poll Supabase every 5min for queued_to_apply jobs
2. Skip companies with active interviews
3. Detect ATS type → route to easy_apply or vision_apply
4. Easy Apply: fill static fields, upload .docx resume
5. Vision Apply: screenshot → Claude Vision → execute actions
6. On success: status=applied, log to application_log
7. On failure: retry 3x (30s delay), then status=manual_required
8. Throttle: 45-90s delay, 5min pause every 10, 100/day cap, 6am-11pm only
