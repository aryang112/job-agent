# Job Agent — Setup Guide

## What you'll have when done
A permanent URL (e.g. `job-agent.vercel.app`) that:
- Shows your full job pipeline every day
- Auto-scans Indeed every weekday at 8am ET
- Scores every job against your profile with Claude
- Tracks applied, interviewing, skipped status

Estimated setup time: **25 minutes**

---

## Step 1 — Supabase (your database, free)

1. Go to **supabase.com** → Sign up → Create new project
2. Name it `job-agent`, pick any password, pick a US region
3. Wait ~2 min for it to spin up
4. Click **SQL Editor** in the left sidebar
5. Paste the entire contents of `SUPABASE_SCHEMA.sql` and click **Run**
6. Go to **Settings → API** and copy:
   - `Project URL` → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → this is your `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2 — Anthropic API Key

1. Go to **console.anthropic.com** → API Keys → Create Key
2. Copy it — this is your `ANTHROPIC_API_KEY`

---

## Step 3 — Push to GitHub

```bash
# In your terminal, from this project folder:
git init
git add .
git commit -m "Initial job agent"
git remote add origin https://github.com/YOUR_USERNAME/job-agent.git
git push -u origin main
```

---

## Step 4 — Deploy to Vercel

1. Go to **vercel.com** → New Project → Import your `job-agent` repo
2. Framework: **Next.js** (auto-detected)
3. Before clicking Deploy, go to **Environment Variables** and add ALL of these:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | sk-ant-... |
| `NEXT_PUBLIC_SUPABASE_URL` | https://xxxx.supabase.co |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | eyJ... |
| `SUPABASE_SERVICE_ROLE_KEY` | eyJ... |
| `CRON_SECRET` | any-long-random-string-you-make-up |

4. Click **Deploy**
5. Done — Vercel gives you a URL like `job-agent-xyz.vercel.app`

---

## Step 5 — First Scan

1. Open your Vercel URL
2. Click **↻ SCAN NOW** in the top right
3. Wait ~2-3 minutes — it's searching Indeed and scoring each job with Claude
4. Jobs will start appearing in the **TO APPLY** tab

After this, the cron job runs automatically every weekday at 8am ET.

---

## Step 6 — Daily Workflow (takes ~10 min)

1. Open your URL
2. Go to **TO APPLY** tab — these are your best matches (score 80+)
3. Click a job → read the fit score + pitch
4. Click **↗ OPEN JOB** → apply on Indeed (your info is in the checklist)
5. Click **✓ APPLIED** to move it to your tracker
6. Repeat for each match

---

## Updating Your Profile

Your profile and skills are in `lib/profile.ts`. Edit that file and push to GitHub — Vercel auto-redeploys.

---

## Notes

- The `CRON_SECRET` you made up is what protects your scan endpoint. Keep it private.
- Supabase free tier handles thousands of jobs easily.
- Vercel free tier includes cron jobs on the Hobby plan.
- Indeed MCP integration uses your Anthropic API key — normal token usage applies.
