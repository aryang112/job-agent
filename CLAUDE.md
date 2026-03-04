# Job Agent — CLAUDE.md

## Project Context
Autonomous job discovery + application pipeline for Aryan Gupta (Sr SDET, 8yr exp, Public Trust, Remote).
- **Vercel App**: Next.js 14 + Supabase + Anthropic Claude for scoring
- **Windows Agent**: Python + Playwright for auto-applying to jobs
- **Dashboard**: Single-page React app with job pipeline management

## Tech Stack
- Next.js 14.2.3 (App Router), React 18, TypeScript 5
- Supabase (PostgreSQL), @supabase/supabase-js 2.x
- @anthropic-ai/sdk 0.24.3 (Claude Sonnet for scoring, Indeed MCP for search)
- Python 3.11+ / Playwright (windows-agent/)
- Deployed on Vercel, cron-triggered scans

## Commands
- `npm run dev` — local dev server
- `npm run build` — production build (use to validate)
- `npm start` — start production server
- Python agent: `cd windows-agent && pip install -r requirements.txt && python agent.py`

## Permissions (for autonomous execution)
- ALLOW: all file read/write/create
- ALLOW: npm/node/npx/next commands
- ALLOW: git add/commit (no force push, no reset --hard)
- ALLOW: Python/pip/playwright commands in windows-agent/
- ALLOW: running dev server, build, tests
- CONFIRM ONLY: destructive git ops, production deploy, deleting branches, sending external messages

## Agent Workflow
1. Read `tasks/todo.md` for current progress and next task
2. Read `CODEBASE.md` for architecture knowledge (avoid re-exploring)
3. Implement, validate, update todo.md progress
4. Update `tasks/lessons.md` after any correction
5. Update `CODEBASE.md` if architecture changes

## Key Files
See CODEBASE.md for full architecture map.

## Database
See CODEBASE.md "Database Schema" section. Migration files in migrations/.
User runs migrations manually in Supabase SQL Editor.
