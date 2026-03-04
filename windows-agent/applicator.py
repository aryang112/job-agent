"""Core submission engine — routes jobs to the right apply flow."""
from ats_detector import detect_ats, detect_ats_from_page
from easy_apply import apply_easy
from vision_apply import VisionApplicator
from logger import log


class Applicator:
    def __init__(self, api_key: str, notes_client=None):
        self.vision = VisionApplicator(api_key, notes_client)

    def apply_to_job(self, page, job: dict, resume_path: str) -> dict:
        """
        Route job to the correct apply flow based on ATS type.
        Returns: { success, pages, fields, resume_uploaded, error, ats_type }
        """
        url = job.get("url", "")
        ats_type = job.get("ats_type") or detect_ats(url)

        log.info(f"Applying to: {job.get('title', '?')} at {job.get('company', '?')} (ATS: {ats_type})")

        if ats_type == "easy_apply":
            result = apply_easy(page, job, resume_path)
        else:
            # Workday, Greenhouse, Lever, iCIMS, Taleo, custom → Vision
            result = self.vision.apply(page, job, resume_path)

        result["ats_type"] = ats_type
        return result
