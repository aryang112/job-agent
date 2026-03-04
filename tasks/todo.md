# Job Agent — Build Progress Tracker

> Agents: check boxes as you complete items. Add review notes at bottom.

## Phase 0: Setup & Database Migration
- [x] 0A: Create CLAUDE.md for autonomous execution
- [x] 0A: Create CODEBASE.md knowledge base
- [x] 0A: Create tasks/todo.md and tasks/lessons.md
- [x] 0B: Create migrations/001_upgrade.sql
- [x] 0B: Update SUPABASE_SCHEMA.sql with new schema
- [x] 0B: Seed 4 notes stories in migration

## Phase 1: Scoring Engine Upgrade
- [x] 1A: Expand search queries (user simplified to 6 targeted queries)
- [x] 1B: Add DEFENSE_PRIMES and CLEARANCE_KEYWORDS constants
- [x] 1C: Update scoring prompt (removed salary penalty, added federal rules)
- [x] 1D: Update scan route with auto-queue logic and score boosts

## Phase 2: Notes Bank API
- [x] 2A: Create /api/notes CRUD endpoints (GET, POST)
- [x] 2B: Create /api/notes/[id] endpoint (PATCH, DELETE)

## Phase 3: API Upgrades
- [x] 3A: Update GET /api/jobs with filters, search, sort
- [x] 3B: Update PATCH /api/jobs with 11 statuses
- [x] 3C: Update GET /api/stats with new metrics
- [x] 3D: Create GET /api/application-log endpoint
- [x] 3E: Add logout (DELETE /api/auth)

## Phase 4: Dashboard Upgrade
- [x] 4A: Logout button in top bar
- [x] 4B: Update stats bar (6 new metrics)
- [x] 4C: Active interview banner
- [x] 4D: Update filter tabs (TO APPLY | APPLIED | INTERVIEWING | MANUAL ACTION | ALL)
- [x] 4E: Search + sort controls
- [x] 4F: Federal/defense badges on job cards
- [x] 4G: Enhanced job detail panel (status dropdown, notes, federal, ATS, timeline)
- [x] 4H: Notes Bank UI (modal with CRUD)
- [x] 4I: Manual Action Queue view with checklist

## Phase 5: Cron Update
- [x] 5: Add second daily scan (0 19 * * 1-5 = 2pm ET)

## Phase 6: Windows Agent
- [x] 6A: Project structure + requirements.txt
- [x] 6B: Core polling loop (agent.py)
- [x] 6C: Easy Apply flow (easy_apply.py)
- [x] 6D: Vision Apply flow (vision_apply.py)
- [x] 6E: Notes integration (notes_client.py)
- [x] 6F: ATS detection (ats_detector.py)
- [x] 6G: Configuration (config.json template)
- [x] 6H: Task Scheduler setup (setup_scheduler.bat)

---

## Review Notes
- **2026-03-04**: All phases implemented. TypeScript compiles clean (npx tsc --noEmit = 0 errors).
- Build requires env vars (Supabase URL) — works on Vercel, not locally without .env.
- User modified searchIndeed to scrape HTML directly instead of MCP proxy.
- User simplified search queries from 16 to 6 targeted ones.
- Python validation skipped (Python not installed on dev machine yet).
- **User action needed**: Run migrations/001_upgrade.sql in Supabase SQL Editor.
- **User action needed**: Install Python 3.11+ and `pip install -r requirements.txt` + `playwright install chromium`.
- **User action needed**: Copy config.example.json → config.json and fill API keys.
