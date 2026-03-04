# Windows Job Application Agent

Autonomous desktop agent that polls Supabase for queued jobs and auto-applies using Playwright.

## Setup

1. **Install Python 3.11+** and ensure it's in PATH

2. **Install dependencies:**
   ```
   cd windows-agent
   pip install -r requirements.txt
   playwright install chromium
   ```

3. **Configure:**
   ```
   copy config.example.json config.json
   ```
   Edit `config.json` with your API keys and Supabase credentials.

4. **Run:**
   ```
   python agent.py
   ```

5. **Auto-start on boot (optional):**
   Run `setup_scheduler.bat` as Administrator.

## How It Works

1. Polls Supabase every 5 min for `status=queued_to_apply` jobs
2. Skips companies where you have active interviews
3. Detects ATS type (Indeed Easy Apply, Workday, Greenhouse, Lever, etc.)
4. **Easy Apply**: Fills Indeed's native form with static candidate data
5. **Other ATS**: Screenshots page → Claude Vision analyzes → Playwright fills
6. For open-ended questions, fetches relevant stories from Notes Bank
7. On success: status → `applied`, logged to `application_log`
8. On failure (3 retries): status → `manual_required` with failure reason

## Throttling
- 45-90s random delay between apps
- 5-minute pause every 10 applications
- 100/day cap
- Active hours: 6am-11pm only

## Files
- `agent.py` — Main polling loop
- `applicator.py` — Routes to correct ATS flow
- `easy_apply.py` — Indeed Easy Apply automation
- `vision_apply.py` — Claude Vision for other ATS systems
- `notes_client.py` — Answers open-ended questions from notes bank
- `ats_detector.py` — URL-based ATS detection
- `field_mapper.py` — Candidate data for form filling
- `supabase_client.py` — Database operations
- `throttle.py` — Rate limiting and scheduling
- `logger.py` — Console + Supabase logging
