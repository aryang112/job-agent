"""Claude Vision-based ATS form filling for non-Indeed applications."""
import base64
import io
import json
import anthropic
from PIL import Image
from playwright.sync_api import Page
from field_mapper import CANDIDATE, get_field_value
from logger import log

MAX_SCREENSHOT_DIMENSION = 7500  # Claude Vision max is 8000px


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
                # Screenshot and resize to stay within Claude's 8000px limit
                b64_image = self._take_screenshot(page)

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

    def _take_screenshot(self, page: Page) -> str:
        """Take a full-page screenshot, resizing if it exceeds Claude's 8000px limit."""
        raw = page.screenshot(type="png", full_page=True)
        img = Image.open(io.BytesIO(raw))
        w, h = img.size

        if w > MAX_SCREENSHOT_DIMENSION or h > MAX_SCREENSHOT_DIMENSION:
            scale = min(MAX_SCREENSHOT_DIMENSION / w, MAX_SCREENSHOT_DIMENSION / h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            log.info(f"Resized screenshot from {w}x{h} to {new_w}x{new_h}")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

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

CRITICAL CSS SELECTOR RULES:
- Use ONLY standard CSS selectors. NO jQuery pseudo-selectors.
- NEVER use :contains(), :has-text(), :visible, or any non-standard pseudo-class.
- For buttons with specific text, use: button[type="submit"], input[type="submit"], or target by ID/class/aria-label.
  Examples: button[aria-label="Apply"], button.apply-btn, #submit-btn, button[data-testid="apply"]
- For inputs, use: input[name="..."], input[id="..."], input[type="..."], textarea[name="..."]
- For dropdowns, use: select[name="..."], select[id="..."]
- If you cannot determine a precise selector, use a generic one like "button[type='submit']" or describe by index: "button >> nth=0"

Rules:
- Fill visible form fields with candidate data
- Click "Next", "Continue", "Apply", or "Submit" buttons when form is filled
- If the page needs to be scrolled down to see a button (e.g. "Apply Now" at the bottom), return a scroll action: {{"selector": "body", "action": "scroll", "value": "down", "description": "Scroll down to reveal Apply button"}}
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

    def _sanitize_selector(self, selector: str) -> str:
        """Remove invalid jQuery pseudo-selectors that Playwright doesn't support."""
        import re
        # Remove :contains("..."), :has-text("..."), :visible, etc.
        sanitized = re.sub(r':contains\(["\']?[^)]*["\']?\)', '', selector)
        sanitized = re.sub(r':has-text\(["\']?[^)]*["\']?\)', '', sanitized)
        sanitized = re.sub(r':visible', '', sanitized)
        sanitized = re.sub(r':first', '', sanitized)
        sanitized = sanitized.strip().rstrip(',')
        return sanitized if sanitized else selector

    def _find_element(self, page: Page, selector: str, desc: str):
        """Try to find element with fallback strategies."""
        # First try the given selector (sanitized)
        clean = self._sanitize_selector(selector)
        try:
            el = page.locator(clean).first
            if el.is_visible(timeout=2000):
                return el
        except Exception:
            pass

        # Fallback: try to find by text content in description
        desc_lower = (desc or "").lower()
        if any(kw in desc_lower for kw in ["apply", "submit", "next", "continue"]):
            # Try common button patterns
            for fallback in [
                "button[type='submit']", "input[type='submit']",
                "button.btn-primary", "a.apply-button",
                "button >> text=Apply", "button >> text=Submit",
                "button >> text=Next", "button >> text=Continue",
            ]:
                try:
                    el = page.locator(fallback).first
                    if el.is_visible(timeout=1000):
                        log.info(f"Fallback selector matched: {fallback}")
                        return el
                except Exception:
                    continue

        log.warning(f"Element not found with any strategy: {clean}")
        return None

    def _execute_action(self, page: Page, action: dict, resume_path: str, job: dict, result: dict) -> bool:
        """Execute a single action from Claude Vision's instructions."""
        try:
            selector = action.get("selector", "")
            act = action.get("action", "")
            value = action.get("value", "")
            desc = action.get("description", "")

            if act == "skip":
                return False

            # Handle scroll action
            if act == "scroll":
                direction = (value or "down").lower()
                if direction == "down":
                    page.evaluate("window.scrollBy(0, 600)")
                elif direction == "up":
                    page.evaluate("window.scrollBy(0, -600)")
                elif direction == "bottom":
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                log.info(f"Scrolled {direction}: {desc}")
                page.wait_for_timeout(1000)
                return True

            element = self._find_element(page, selector, desc)
            if not element:
                return False

            # Scroll element into view before interacting
            element.scroll_into_view_if_needed(timeout=3000)

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
