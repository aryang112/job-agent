"""Main polling loop — the Windows desktop job application agent."""
import json
import time
import sys
import os
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync

from supabase_client import SupabaseOps
from applicator import Applicator
from notes_client import NotesClient
from throttle import Throttle
from logger import log, log_application

# Persistent browser profile directory (keeps cookies/localStorage between runs)
PROFILE_DIR = os.path.join(os.path.dirname(__file__), "browser_profile")


def load_config() -> dict:
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if not os.path.exists(config_path):
        log.error("config.json not found. Copy config.example.json and fill in your keys.")
        sys.exit(1)
    with open(config_path) as f:
        return json.load(f)


def main():
    config = load_config()
    log.info("Job Agent starting...")

    # Initialize clients
    db = SupabaseOps(config["supabase_url"], config["supabase_service_key"])
    notes = NotesClient(db, config["anthropic_api_key"])
    applicator = Applicator(config["anthropic_api_key"], notes)
    throttle = Throttle(config.get("throttle", {}))
    retry_config = config.get("retry", {"max_attempts": 3, "delay_seconds": 30})
    resume_path = config.get("resume_path", "")
    poll_interval = config.get("poll_interval_seconds", 300)

    if not os.path.exists(resume_path):
        log.error(f"Resume not found at: {resume_path}")
        sys.exit(1)

    log.info(f"Resume: {resume_path}")
    log.info(f"Poll interval: {poll_interval}s, Max daily: {throttle.max_daily}")

    with sync_playwright() as p:
        # Persistent context: cookies/localStorage survive between runs
        # Cloudflare remembers "verified" browsers, reducing challenges
        os.makedirs(PROFILE_DIR, exist_ok=True)
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            args=[
                "--disable-blink-features=AutomationControlled",  # Hide automation flag
            ],
        )
        page = context.pages[0] if context.pages else context.new_page()
        # Apply stealth patches (hides navigator.webdriver, chrome.runtime, etc.)
        stealth_sync(page)

        while True:
            try:
                # Wait for active hours
                throttle.wait_until_active()

                if not throttle.can_apply():
                    log.info("Daily cap reached. Sleeping until tomorrow...")
                    time.sleep(3600)
                    continue

                # Poll for queued jobs
                jobs = db.get_queued_jobs(limit=5)
                if not jobs:
                    log.info(f"No queued jobs. Sleeping {poll_interval}s...")
                    time.sleep(poll_interval)
                    continue

                # Get companies with active interviews (skip those)
                interviewing = db.get_interviewing_companies()

                for job in jobs:
                    if not throttle.can_apply():
                        break

                    # Skip if interviewing at this company
                    if job.get("company", "").lower() in interviewing:
                        log.info(f"Skipping {job['company']} — active interview")
                        continue

                    # Attempt application
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
                        else:
                            retry_count = db.increment_retry(job["id"])
                            log.warning(f"Attempt {attempt + 1} failed: {result.get('error', 'unknown')}")

                            if attempt < retry_config["max_attempts"] - 1:
                                time.sleep(retry_config["delay_seconds"])

                    if not success:
                        db.update_job_status(
                            job["id"], "manual_required",
                            f"Agent failed after {retry_config['max_attempts']} attempts: {result.get('error', 'unknown')}"
                        )
                        log.warning(f"MANUAL REQUIRED: {job['title']} at {job['company']}")

                    # Throttle between applications
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
