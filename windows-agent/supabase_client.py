"""All Supabase read/write operations for the agent."""
from supabase import create_client


class SupabaseOps:
    def __init__(self, url: str, key: str):
        self.client = create_client(url, key)

    def get_queued_jobs(self, limit: int = 10):
        """Fetch jobs with status=queued_to_apply, easy_apply first then by score DESC."""
        result = self.client.table("jobs") \
            .select("*") \
            .eq("status", "queued_to_apply") \
            .order("score", desc=True) \
            .limit(limit * 2) \
            .execute()
        jobs = result.data or []
        # Sort: easy_apply first, then by score descending
        jobs.sort(key=lambda j: (
            0 if j.get("ats_type") == "easy_apply" else 1,
            -(j.get("score") or 0),
        ))
        return jobs[:limit]

    def get_interviewing_companies(self):
        """Get companies where we're currently interviewing."""
        result = self.client.table("jobs") \
            .select("company") \
            .in_("status", ["screening", "interviewing", "offer"]) \
            .execute()
        return {r["company"].lower() for r in (result.data or [])}

    def update_job_status(self, job_id: str, status: str, agent_log: str = None):
        """Update a job's status and optional agent_log."""
        update = {"status": status}
        if status == "applied":
            from datetime import datetime
            update["applied_at"] = datetime.utcnow().isoformat()
        if agent_log:
            update["agent_log"] = agent_log
        self.client.table("jobs").update(update).eq("id", job_id).execute()

    def increment_retry(self, job_id: str):
        """Increment retry count for a job."""
        result = self.client.table("jobs").select("retry_count").eq("id", job_id).single().execute()
        current = (result.data or {}).get("retry_count", 0)
        self.client.table("jobs").update({"retry_count": current + 1}).eq("id", job_id).execute()
        return current + 1

    def get_notes(self, keywords: list[str] = None):
        """Fetch notes, optionally filtered by keyword overlap."""
        result = self.client.table("notes").select("*").execute()
        notes = result.data or []
        if keywords:
            # Score notes by keyword overlap
            def score(note):
                note_kw = set(k.lower() for k in (note.get("keywords") or []))
                return len(note_kw & set(k.lower() for k in keywords))
            notes.sort(key=score, reverse=True)
        return notes

    def mark_note_used(self, note_id: int):
        """Update last_used timestamp for a note."""
        from datetime import datetime
        self.client.table("notes").update(
            {"last_used": datetime.utcnow().isoformat()}
        ).eq("id", note_id).execute()
