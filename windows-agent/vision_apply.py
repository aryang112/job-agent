"""Claude Vision-based ATS form filling for non-Indeed applications.

Strategy: viewport-based navigation.
- Always screenshot what's currently visible (1280x~800), never full-page.
- Claude sees crisp, readable content and decides: fill fields, click buttons, or scroll.
- Each iteration is one viewport screenshot → actions → next screenshot.
"""
import base64
import io
import json
import re
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
            page.wait_for_timeout(2000)
            result["pages"] += 1

            max_iterations = 20
            consecutive_scroll_only = 0  # track if we're stuck just scrolling

            for iteration in range(max_iterations):
                # Check for blockers via page text
                try:
                    page_text = page.inner_text("body").lower()
                except Exception:
                    page_text = ""

                if "captcha" in page_text or "verify you are human" in page_text:
                    result["error"] = "CAPTCHA detected"
                    return result
                if "sign in" in page_text[:500] or "log in" in page_text[:500]:
                    # Only block if it looks like a login wall, not just a nav link
                    if "sign in to" in page_text[:500] or "log in to" in page_text[:500] or "please sign in" in page_text[:1000]:
                        result["error"] = "Login wall detected"
                        return result

                # Check for success
                success_phrases = ["application submitted", "thank you for applying",
                                   "successfully applied", "application received",
                                   "application has been submitted"]
                if any(p in page_text for p in success_phrases):
                    result["success"] = True
                    log.info("Application submitted successfully!")
                    return result

                # Take viewport screenshot (what's actually visible, crisp and readable)
                screenshot = page.screenshot(type="png")  # viewport only, no full_page
                b64_image = base64.b64encode(screenshot).decode()
                log.info(f"Step {iteration + 1}: viewport screenshot taken")

                # Ask Claude Vision what to do
                actions = self._analyze_page(b64_image, job, iteration)
                if not actions:
                    result["error"] = "Vision could not determine actions"
                    return result

                # Track if this iteration only scrolled (no real form interaction)
                did_real_action = False

                # Execute actions
                for action in actions:
                    act = action.get("action", "")
                    executed = self._execute_action(page, action, resume_path, job, result)
                    if executed and act != "scroll":
                        did_real_action = True
                        result["fields"] += 1

                if did_real_action:
                    consecutive_scroll_only = 0
                else:
                    consecutive_scroll_only += 1

                # If we've scrolled 5 times without doing anything useful, we're stuck
                if consecutive_scroll_only >= 5:
                    result["error"] = "Stuck scrolling — no actionable form fields found"
                    return result

                page.wait_for_timeout(1500)
                result["pages"] += 1

            result["error"] = "Max iterations reached"
            return result

        except Exception as e:
            result["error"] = str(e)[:200]
            return result

    def _analyze_page(self, b64_image: str, job: dict, step: int) -> list[dict]:
        """Send viewport screenshot to Claude Vision and get form-filling actions."""
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

        prompt = f"""You are an automated job application assistant. This is a screenshot of what is CURRENTLY VISIBLE in the browser viewport (step {step + 1}).

Candidate data:
{candidate_info}

Return a JSON array of actions. Each action:
{{
  "selector": "CSS selector for the element",
  "action": "fill" | "click" | "select" | "upload" | "scroll" | "skip",
  "value": "value to enter (for fill/select) or scroll direction (for scroll)",
  "description": "what this field/action is"
}}

SELECTOR RULES (CRITICAL):
- Use ONLY standard CSS selectors. NEVER use :contains(), :has-text(), :visible, or jQuery.
- Target by id, name, class, type, aria-label, data-testid, or placeholder.
  Good: input[name="email"], #first-name, button[type="submit"], textarea.cover-letter
  Bad: button:contains("Apply"), input:visible
- If unsure of exact selector, use Playwright text selectors: "button >> text=Apply Now"

WHAT TO DO:
- If you see form fields: fill them with candidate data and return fill actions.
- If you see a button (Apply, Next, Continue, Submit): return a click action for it.
- If the page shows a job description and you need to scroll down to find the Apply button or form: return {{"selector": "body", "action": "scroll", "value": "down", "description": "Scroll to find Apply button/form"}}
- If you see "Apply Now", "Quick Apply", "Easy Apply" button: click it immediately.
- For file upload (resume): use action "upload".
- Skip salary fields, cover letter, and questions you cannot answer.

IMPORTANT: Only act on what you can SEE in this screenshot. Do not guess about off-screen elements.
Return ONLY the JSON array, no other text."""

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
            actions = json.loads(text) if text.startswith("[") else []
            log.info(f"Vision returned {len(actions)} actions")
            return actions
        except json.JSONDecodeError as e:
            log.error(f"Vision returned invalid JSON: {e}")
            return []
        except Exception as e:
            log.error(f"Vision analysis failed: {e}")
            return []

    def _sanitize_selector(self, selector: str) -> str:
        """Strip invalid jQuery pseudo-selectors that Playwright doesn't support."""
        sanitized = re.sub(r':contains\(["\']?[^)]*["\']?\)', '', selector)
        sanitized = re.sub(r':has-text\(["\']?[^)]*["\']?\)', '', sanitized)
        sanitized = re.sub(r':visible', '', sanitized)
        sanitized = re.sub(r':first\b', '', sanitized)
        sanitized = sanitized.strip().rstrip(',')
        return sanitized if sanitized else selector

    def _find_element(self, page: Page, selector: str, desc: str):
        """Try to find element with sanitized selector, then fallback strategies."""
        clean = self._sanitize_selector(selector)

        # Try primary selector
        try:
            el = page.locator(clean).first
            if el.is_visible(timeout=2000):
                return el
        except Exception:
            pass

        # Try Playwright text selector if it looks like one
        if ">>" in selector:
            try:
                el = page.locator(selector).first
                if el.is_visible(timeout=2000):
                    return el
            except Exception:
                pass

        # Fallback for buttons: try common patterns
        desc_lower = (desc or "").lower()
        if any(kw in desc_lower for kw in ["apply", "submit", "next", "continue", "button"]):
            fallbacks = [
                "button[type='submit']", "input[type='submit']",
                "button.btn-primary", "a.apply-button", "a.btn-primary",
            ]
            # Also try text-based Playwright selectors
            for word in ["Apply", "Apply Now", "Submit", "Next", "Continue"]:
                fallbacks.append(f"button >> text={word}")
                fallbacks.append(f"a >> text={word}")

            for fb in fallbacks:
                try:
                    el = page.locator(fb).first
                    if el.is_visible(timeout=800):
                        log.info(f"Fallback matched: {fb}")
                        return el
                except Exception:
                    continue

        log.warning(f"Element not found: {clean}")
        return None

    def _execute_action(self, page: Page, action: dict, resume_path: str, job: dict, result: dict) -> bool:
        """Execute a single action from Claude Vision."""
        try:
            selector = action.get("selector", "")
            act = action.get("action", "")
            value = action.get("value", "")
            desc = action.get("description", "")

            if act == "skip":
                return False

            if act == "scroll":
                direction = (value or "down").lower()
                scroll_amount = 700  # roughly one viewport height
                if direction == "down":
                    page.evaluate(f"window.scrollBy(0, {scroll_amount})")
                elif direction == "up":
                    page.evaluate(f"window.scrollBy(0, -{scroll_amount})")
                elif direction == "bottom":
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                elif direction == "top":
                    page.evaluate("window.scrollTo(0, 0)")
                log.info(f"Scrolled {direction}: {desc}")
                page.wait_for_timeout(1000)
                return True  # scroll counts as executed but not as a "real action"

            element = self._find_element(page, selector, desc)
            if not element:
                return False

            # Scroll element into view
            try:
                element.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass

            if act == "fill":
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
                try:
                    element.select_option(label=value)
                except Exception:
                    element.select_option(value=value)
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
