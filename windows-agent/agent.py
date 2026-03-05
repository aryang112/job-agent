"""Main polling loop — the Windows desktop job application agent."""
import json
import time
import sys
import os
from playwright.sync_api import sync_playwright
from undetected_playwright import stealth_sync

from supabase_client import SupabaseOps
from applicator import Applicator
from notes_client import NotesClient
from throttle import Throttle
from logger import log, log_application

# Use real Chrome (not Playwright's bundled Chromium)
CHROME_PATH = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not os.path.exists(CHROME_PATH):
    for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Users\{}\AppData\Local\Google\Chrome\Application\chrome.exe".format(os.getenv("USERNAME", "")),
    ]:
        if os.path.exists(p):
            CHROME_PATH = p
            break

# Persistent browser profile
PROFILE_DIR = os.path.join(os.path.dirname(__file__), "chrome_profile")

# Errors that skip retries → manual_required immediately
SKIP_ERRORS = [
    "Cloudflare challenge",
    "CAPTCHA detected",
    "Login wall detected",
    "Job no longer available",
    "Blocked site",
]

# Sites that consistently block automation
BLOCKED_DOMAINS = [
    "linkedin.com",
    "dice.com",
    "ziprecruiter.com",
    "monster.com",
    "careerbuilder.com",
]


def load_config() -> dict:
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if not os.path.exists(config_path):
        log.error("config.json not found. Copy config.example.json and fill in your keys.")
        sys.exit(1)
    with open(config_path) as f:
        return json.load(f)


def is_skip_error(error: str) -> bool:
    if not error:
        return False
    return any(s.lower() in error.lower() for s in SKIP_ERRORS)


def is_blocked_site(url: str) -> bool:
    if not url:
        return False
    return any(domain in url.lower() for domain in BLOCKED_DOMAINS)


def main():
    config = load_config()
    log.info("Job Agent starting...")

    db = SupabaseOps(config["supabase_url"], config["supabase_service_key"])
    notes = NotesClient(db, config["anthropic_api_key"])
    capsolver_key = config.get("capsolver_api_key", "")
    applicator = Applicator(config["anthropic_api_key"], notes, capsolver_key=capsolver_key)
    throttle = Throttle(config.get("throttle", {}))
    retry_config = config.get("retry", {"max_attempts": 3, "delay_seconds": 30})
    resume_path = config.get("resume_path", "")
    poll_interval = config.get("poll_interval_seconds", 300)

    if not os.path.exists(resume_path):
        log.error(f"Resume not found at: {resume_path}")
        sys.exit(1)

    log.info(f"Resume: {resume_path}")
    log.info(f"Chrome: {CHROME_PATH}")
    log.info(f"Poll interval: {poll_interval}s, Max daily: {throttle.max_daily}")
    log.info(f"CapSolver: {'enabled' if capsolver_key else 'disabled'}")

    with sync_playwright() as p:
        os.makedirs(PROFILE_DIR, exist_ok=True)

        # Launch real Chrome with persistent profile
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            executable_path=CHROME_PATH,
            headless=False,
            viewport={"width": 1280, "height": 900},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-gpu-sandbox",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-infobars",
                "--disable-popup-blocking",
            ],
            ignore_default_args=["--enable-automation"],
        )

        # undetected-playwright: patches CDP to remove automation signals
        # This is what removes the "controlled by automated test software" banner
        stealth_sync(context)
        log.info("Stealth applied via undetected-playwright")

        page = context.pages[0] if context.pages else context.new_page()

        while True:
            try:
                throttle.wait_until_active()

                if not throttle.can_apply():
                    log.info("Daily cap reached. Sleeping until tomorrow...")
                    time.sleep(3600)
                    continue

                jobs = db.get_queued_jobs(limit=5)
                if not jobs:
                    log.info(f"No queued jobs. Sleeping {poll_interval}s...")
                    time.sleep(poll_interval)
                    continue

                interviewing = db.get_interviewing_companies()

                for job in jobs:
                    if not throttle.can_apply():
                        break

                    if job.get("company", "").lower() in interviewing:
                        log.info(f"Skipping {job['company']} — active interview")
                        continue

                    job_url = job.get("url", "")
                    if is_blocked_site(job_url):
                        log.warning(f"Blocked site — skipping: {job_url}")
                        db.update_job_status(
                            job["id"], "manual_required",
                            f"Blocked site (automation not possible): {job_url}"
                        )
                        continue

                    success = False
                    for attempt in range(retry_config["max_attempts"]):
                        result = applicator.apply_to_job(page, job, resume_path)

                        log_application(
                            db.client, job["id"], result["success"],
                            result.get("ats_type", "unknown"),
                            result.get("error"),
                            result.get("pages", 0),
                            result.get("fields", 0),
                            result.get("resume_uploaded", False),
                        )

                        if result["success"]:
                            db.update_job_status(job["id"], "applied",
                                                 f"Auto-applied via {result.get('ats_type', 'unknown')} "
                                                 f"({result.get('pages', 0)} pages, {result.get('fields', 0)} fields)")
                            log.info(f"SUCCESS: {job['title']} at {job['company']}")
                            success = True
                            break

                        error_msg = result.get("error", "unknown")
                        if is_skip_error(error_msg):
                            log.warning(f"Non-retryable: {error_msg} — skipping to manual")
                            break

                        db.increment_retry(job["id"])
                        log.warning(f"Attempt {attempt + 1} failed: {error_msg}")

                        if attempt < retry_config["max_attempts"] - 1:
                            time.sleep(retry_config["delay_seconds"])

                    if not success:
                        db.update_job_status(
                            job["id"], "manual_required",
                            f"Agent failed: {result.get('error', 'unknown')}"
                        )
                        log.warning(f"MANUAL REQUIRED: {job['title']} at {job['company']}")

                    throttle.wait_between_apps()

            except KeyboardInterrupt:
                log.info("Shutting down...")
                break
            except Exception as e:
                log.error(f"Unexpected error: {e}")
                time.sleep(60)

        context.close()


if __name__ == "__main__":
    main()
