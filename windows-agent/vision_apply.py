"""Claude Vision-based ATS form filling for non-Indeed applications."""
import base64
import json
import anthropic
from playwright.sync_api import Page
from field_mapper import CANDIDATE, get_field_value
from logger import log


class VisionApplicator:
    def __init__(self, api_key: str, notes_client=None):
        self.claude = anthropic.Anthropic(api_key=api_key)
        self.notes_client = notes_client

    def apply(self, page: Page, job: dict, resume_path: str) -> dict:
        """
        Use Claude Vision to navigate and fill ATS forms.
        Returns: { success: bool, pages: int, fields: int, resume_uploaded: bool, error: str|None }
        """
        result = {"success": False, "pages": 0, "fields": 0, "resume_uploaded": False, "error": None}

        try:
            url = job.get("url", "")
            if not url:
                result["error"] = "No job URL"
                return result

            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            result["pages"] += 1

            max_iterations = 15
            for iteration in range(max_iterations):
                # Screenshot current page
                screenshot = page.screenshot(type="png")
                b64_image = base64.b64encode(screenshot).decode()

                # Check for blockers
                page_text = page.inner_text("body").lower()
                if "captcha" in page_text or "verify you are human" in page_text:
                    result["error"] = "CAPTCHA detected"
                    return result
                if "sign in" in page_text[:500] or "log in" in page_text[:500]:
                    result["error"] = "Login wall detected"
                    return result

                # Check for success
                success_phrases = ["application submitted", "thank you for applying", "successfully applied"]
                if any(p in page_text for p in success_phrases):
                    result["success"] = True
                    return result

                # Ask Claude Vision what to do
                actions = self._analyze_page(b64_image, job, iteration)
                if not actions:
                    result["error"] = "Vision could not determine actions"
                    return result

                # Execute actions
                for action in actions:
                    executed = self._execute_action(page, action, resume_path, job, result)
                    if executed:
                        result["fields"] += 1

                page.wait_for_timeout(2000)
                result["pages"] += 1

            result["error"] = "Max iterations reached"
            return result

        except Exception as e:
            result["error"] = str(e)[:200]
            return result

    def _analyze_page(self, b64_image: str, job: dict, step: int) -> list[dict]:
        """Send screenshot to Claude Vision and get form-filling actions."""
        candidate_info = json.dumps({
            "name": f"{CANDIDATE['first_name']} {CANDIDATE['last_name']}",
            "email": CANDIDATE["email"],
            "phone": CANDIDATE["phone"],
            "city": CANDIDATE["city"],
            "state": CANDIDATE["state"],
            "zip": CANDIDATE["zip"],
            "work_auth": "Yes",
            "sponsorship": "No",
            "clearance": CANDIDATE["clearance"],
            "current_title": CANDIDATE["current_title"],
            "years_exp": CANDIDATE["years_experience"],
            "education": f"{CANDIDATE['degree']} - {CANDIDATE['university']} ({CANDIDATE['graduation_year']})",
        }, indent=2)

        prompt = f"""You are an automated job application assistant. Analyze this screenshot of a job application form (step {step + 1}).

Candidate data:
{candidate_info}

Return a JSON array of actions to take on this page. Each action:
{{
  "selector": "CSS selector for the element",
  "action": "fill" | "click" | "select" | "upload" | "skip",
  "value": "value to enter (if fill/select)",
  "description": "what this field is"
}}

Rules:
- Fill visible form fields with candidate data
- Click "Next", "Continue", or "Submit" buttons when form is filled
- For file upload fields, use action "upload"
- For questions you can't answer with the data provided, use action "skip"
- For salary fields, skip them (leave blank)
- For cover letter, skip
- Return ONLY the JSON array, no other text"""

        try:
            response = self.claude.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1500,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64_image}},
                        {"type": "text", "text": prompt}
                    ]
                }]
            )
            text = response.content[0].text.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            match = json.loads(text) if text.startswith("[") else []
            return match
        except Exception as e:
            log.error(f"Vision analysis failed: {e}")
            return []

    def _execute_action(self, page: Page, action: dict, resume_path: str, job: dict, result: dict) -> bool:
        """Execute a single action from Claude Vision's instructions."""
        try:
            selector = action.get("selector", "")
            act = action.get("action", "")
            value = action.get("value", "")
            desc = action.get("description", "")

            if act == "skip":
                return False

            element = page.locator(selector).first
            if not element.is_visible(timeout=2000):
                log.warning(f"Element not visible: {selector}")
                return False

            if act == "fill":
                # Check if this is a question that needs notes
                if self.notes_client and _is_open_question(desc):
                    answer = self.notes_client.answer_question(
                        desc, job.get("title", ""), job.get("company", "")
                    )
                    if answer:
                        value = answer

                element.clear()
                element.fill(value)
                log.info(f"Filled '{desc}': {value[:50]}...")
                return True

            elif act == "click":
                element.click()
                page.wait_for_timeout(1500)
                log.info(f"Clicked: {desc}")
                return True

            elif act == "select":
                element.select_option(label=value)
                log.info(f"Selected '{desc}': {value}")
                return True

            elif act == "upload":
                import os
                if os.path.exists(resume_path):
                    element.set_input_files(resume_path)
                    result["resume_uploaded"] = True
                    log.info("Uploaded resume")
                    return True

        except Exception as e:
            log.warning(f"Action failed ({action.get('description', '')}): {e}")
        return False


def _is_open_question(description: str) -> bool:
    """Detect if a form field is an open-ended question needing a story-based answer."""
    indicators = ["why", "describe", "tell us", "explain", "experience with",
                  "how have you", "what is your", "share an example"]
    desc_lower = description.lower()
    return any(ind in desc_lower for ind in indicators)
