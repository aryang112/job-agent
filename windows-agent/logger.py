"""Logging module — local console + Supabase application_log."""
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("job-agent")


def log_application(supabase_client, job_id: str, success: bool, ats_type: str,
                    failure_reason: str = None, pages: int = 0, fields: int = 0,
                    resume_uploaded: bool = False):
    """Write an entry to Supabase application_log table."""
    try:
        supabase_client.table("application_log").insert({
            "job_id": job_id,
            "attempted_at": datetime.utcnow().isoformat(),
            "success": success,
            "ats_type": ats_type,
            "failure_reason": failure_reason,
            "pages_navigated": pages,
            "fields_filled": fields,
            "resume_uploaded": resume_uploaded,
        }).execute()
    except Exception as e:
        log.error(f"Failed to log application: {e}")
