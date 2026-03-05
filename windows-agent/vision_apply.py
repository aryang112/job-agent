"""Hybrid DOM + Vision ATS form filling for non-Indeed applications.

Strategy: DOM-first, Vision-fallback.
Phase 1: Parse DOM to find Apply button and click it (zero API calls).
Phase 2: Parse DOM to identify form fields and fill them with candidate data.
Phase 3: Only use Claude Vision for fields the DOM parser can't figure out.

This avoids scrolling 8-9 times with Vision just to find a button.
"""
import base64
import json
import re
import anthropic
from playwright.sync_api import Page, Locator
from field_mapper import CANDIDATE, get_field_value
from logger import log


# Common Apply button selectors ordered by likelihood
APPLY_BUTTON_SELECTORS = [
    "a >> text=Apply Now",
    "button >> text=Apply Now",
    "a >> text=Apply",
    "button >> text=Apply",
    "a >> text=Quick Apply",
    "button >> text=Quick Apply",
    "a >> text=Easy Apply",
    "button >> text=Easy Apply",
    "a >> text=Apply for this job",
    "button >> text=Apply for this job",
    "a >> text=Submit Application",
    "button >> text=Submit Application",
    "a[class*='apply']",
    "button[class*='apply']",
    "a[data-testid*='apply']",
    "button[data-testid*='apply']",
    "a[id*='apply']",
    "button[id*='apply']",
]

# Map common form label patterns to candidate data
FIELD_MAP = {
    # Name fields
    r"first.?name": CANDIDATE.get("first_name", ""),
    r"last.?name": CANDIDATE.get("last_name", ""),
    r"full.?name": f"{CANDIDATE.get('first_name', '')} {CANDIDATE.get('last_name', '')}",
    # Contact
    r"email": CANDIDATE.get("email", ""),
    r"phone|mobile|telephone": CANDIDATE.get("phone", ""),
    # Location
    r"city": CANDIDATE.get("city", ""),
    r"state|province": CANDIDATE.get("state", ""),
    r"zip|postal": CANDIDATE.get("zip", ""),
    r"address|street": CANDIDATE.get("address", ""),
    r"country": "United States",
    # Professional
    r"current.?title|job.?title|position": CANDIDATE.get("current_title", ""),
    r"company|employer|current.?company|organization": "GDIT",
    r"years?.?(of)?.?experience|experience.?years": str(CANDIDATE.get("years_experience", "")),
    r"linkedin": CANDIDATE.get("linkedin", ""),
    r"website|portfolio|url": CANDIDATE.get("website", ""),
    # Work authorization
    r"authorized|work.?auth|eligible|legally": "Yes",
    r"sponsor|visa": "No",
    r"clearance|security": CANDIDATE.get("clearance", ""),
    # Education
    r"school|university|college|institution": CANDIDATE.get("university", ""),
    r"degree": CANDIDATE.get("degree", ""),
    r"graduation|grad.?year": CANDIDATE.get("graduation_year", ""),
    r"gpa": "",
    r"major|field.?of.?study": CANDIDATE.get("major", ""),
}

# Fields to skip
SKIP_PATTERNS = [
    r"salary|compensation|pay|desired.?rate|expected.?salary",
    r"cover.?letter",
    r"hear.?about|how.?did.?you|referral|source",
    r"gender|race|ethnicity|veteran|disability|demographic",
    r"start.?date|available|availability",
]


class VisionApplicator:
    def __init__(self, api_key: str, notes_client=None):
        self.claude = anthropic.Anthropic(api_key=api_key)
        self.notes_client = notes_client

    def apply(self, page: Page, job: dict, resume_path: str) -> dict:
        result = {"success": False, "pages": 0, "fields": 0, "resume_uploaded": False, "error": None}

        try:
            url = job.get("url", "")
            if not url:
                result["error"] = "No job URL"
                return result

            log.info(f"Navigating to: {url}")
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            result["pages"] += 1

            # --- Phase 1: Find and click Apply button via DOM ---
            if not self._is_on_form(page):
                clicked = self._click_apply_button(page)
                if not clicked:
                    result["error"] = "Could not find Apply button via DOM"
                    return result
                page.wait_for_timeout(3000)
                result["pages"] += 1

            # --- Phase 2+3: Fill form (DOM-first, Vision-fallback) ---
            max_pages = 10
            for page_num in range(max_pages):
                # Check blockers
                blocker = self._check_blockers(page)
                if blocker == "success":
                    result["success"] = True
                    log.info("Application submitted successfully!")
                    return result
                if blocker:
                    result["error"] = blocker
                    return result

                # Try DOM-based form filling first
                dom_filled = self._fill_form_via_dom(page, resume_path, result)
                log.info(f"DOM filled {dom_filled} fields on page {page_num + 1}")

                # Check for unfilled required fields or complex fields — use Vision
                unfilled = self._get_unfilled_fields(page)
                if unfilled:
                    log.info(f"Found {len(unfilled)} unfilled fields, using Vision")
                    vision_filled = self._fill_with_vision(page, job, resume_path, result, unfilled)
                    log.info(f"Vision filled {vision_filled} additional fields")

                # Click Next/Submit/Continue
                submitted = self._click_next_or_submit(page)
                if not submitted:
                    # Maybe we're done or stuck
                    if self._check_blockers(page) == "success":
                        result["success"] = True
                        return result
                    result["error"] = "Could not find Next/Submit button"
                    return result

                page.wait_for_timeout(3000)
                result["pages"] += 1

                # Check if we landed on success page
                if self._check_blockers(page) == "success":
                    result["success"] = True
                    return result

            result["error"] = "Max form pages reached"
            return result

        except Exception as e:
            result["error"] = str(e)[:200]
            return result

    # ---- Phase 1: Apply Button Discovery ----

    def _click_apply_button(self, page: Page) -> bool:
        """Find and click the Apply button using DOM selectors."""
        for selector in APPLY_BUTTON_SELECTORS:
            try:
                el = page.locator(selector).first
                if el.is_visible(timeout=500):
                    el.scroll_into_view_if_needed()
                    el.click()
                    log.info(f"Clicked Apply button: {selector}")
                    return True
            except Exception:
                continue

        # Last resort: search all links/buttons for "apply" text
        for tag in ["a", "button"]:
            try:
                elements = page.locator(tag).all()
                for el in elements:
                    try:
                        text = el.inner_text(timeout=500).lower().strip()
                        if "apply" in text and len(text) < 30:
                            el.scroll_into_view_if_needed()
                            el.click()
                            log.info(f"Clicked Apply via text scan: '{text}'")
                            return True
                    except Exception:
                        continue
            except Exception:
                continue

        log.warning("No Apply button found via DOM")
        return False

    def _is_on_form(self, page: Page) -> bool:
        """Check if current page already has a form (not just a job description)."""
        try:
            inputs = page.locator("form input, form textarea, form select").count()
            return inputs >= 2
        except Exception:
            return False

    # ---- Phase 2: DOM-based Form Filling ----

    def _fill_form_via_dom(self, page: Page, resume_path: str, result: dict) -> int:
        """Fill form fields by matching labels/names/placeholders to candidate data."""
        filled = 0

        # Find all input/textarea/select within forms
        fields = self._get_form_fields(page)

        for field_info in fields:
            element = field_info["element"]
            label_text = field_info["label"].lower()
            input_type = field_info["type"]
            name = field_info["name"].lower()

            # Skip hidden, already filled, or file inputs (handled separately)
            if input_type == "hidden":
                continue
            if input_type == "file":
                self._upload_resume(element, resume_path, result)
                continue

            # Check if we should skip this field
            combined = f"{label_text} {name}"
            if any(re.search(pat, combined) for pat in SKIP_PATTERNS):
                log.info(f"Skipping field: {label_text or name}")
                continue

            # Try to match to candidate data
            value = self._match_field_value(combined)
            if value and input_type in ("text", "email", "tel", "number", "url", ""):
                try:
                    element.clear()
                    element.fill(value)
                    filled += 1
                    result["fields"] += 1
                    log.info(f"DOM filled '{label_text or name}': {value[:40]}")
                except Exception as e:
                    log.warning(f"Failed to fill '{label_text or name}': {e}")

            elif value and input_type == "select":
                try:
                    # Try exact match, then partial
                    try:
                        element.select_option(label=value)
                    except Exception:
                        element.select_option(value=value)
                    filled += 1
                    result["fields"] += 1
                    log.info(f"DOM selected '{label_text or name}': {value}")
                except Exception:
                    pass

        return filled

    def _get_form_fields(self, page: Page) -> list[dict]:
        """Extract form fields with their labels."""
        fields = []
        try:
            # Get all visible inputs/textareas/selects
            for selector in ["input", "textarea", "select"]:
                elements = page.locator(f"form {selector}").all()
                for el in elements:
                    try:
                        if not el.is_visible(timeout=300):
                            continue
                    except Exception:
                        continue

                    # Get field metadata
                    try:
                        attrs = el.evaluate("""el => ({
                            type: el.type || el.tagName.toLowerCase(),
                            name: el.name || '',
                            id: el.id || '',
                            placeholder: el.placeholder || '',
                            ariaLabel: el.getAttribute('aria-label') || '',
                            value: el.value || '',
                        })""")
                    except Exception:
                        continue

                    # Find label text
                    label = ""
                    field_id = attrs.get("id", "")
                    if field_id:
                        try:
                            label_el = page.locator(f"label[for='{field_id}']").first
                            label = label_el.inner_text(timeout=300)
                        except Exception:
                            pass

                    if not label:
                        label = attrs.get("ariaLabel", "") or attrs.get("placeholder", "")

                    # Skip already-filled fields
                    if attrs.get("value", "").strip():
                        continue

                    fields.append({
                        "element": el,
                        "label": label,
                        "type": attrs.get("type", ""),
                        "name": attrs.get("name", ""),
                        "id": field_id,
                    })
        except Exception as e:
            log.warning(f"Error scanning form fields: {e}")

        return fields

    def _match_field_value(self, field_text: str) -> str:
        """Match a field label/name to candidate data using FIELD_MAP."""
        for pattern, value in FIELD_MAP.items():
            if re.search(pattern, field_text):
                return str(value)
        return ""

    def _upload_resume(self, element: Locator, resume_path: str, result: dict):
        """Upload resume file."""
        import os
        if resume_path and os.path.exists(resume_path):
            try:
                element.set_input_files(resume_path)
                result["resume_uploaded"] = True
                log.info("Uploaded resume via DOM")
            except Exception as e:
                log.warning(f"Resume upload failed: {e}")

    def _get_unfilled_fields(self, page: Page) -> list[dict]:
        """Find form fields that are still empty (DOM filling missed them)."""
        unfilled = []
        try:
            fields = self._get_form_fields(page)
            for f in fields:
                if f["type"] not in ("hidden", "file", "submit", "button", "checkbox", "radio"):
                    unfilled.append(f)
        except Exception:
            pass
        return unfilled

    # ---- Phase 3: Vision Fallback ----

    def _fill_with_vision(self, page: Page, job: dict, resume_path: str, result: dict, unfilled: list) -> int:
        """Use Claude Vision for fields that DOM parsing couldn't handle."""
        # Take viewport screenshot
        screenshot = page.screenshot(type="png")
        b64_image = base64.b64encode(screenshot).decode()

        # Build description of unfilled fields
        field_descriptions = []
        for f in unfilled[:10]:  # Cap at 10
            field_descriptions.append(f"- '{f['label'] or f['name']}' (type={f['type']}, name={f['name']})")
        fields_text = "\n".join(field_descriptions) if field_descriptions else "Unknown fields visible"

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

        prompt = f"""You are filling a job application form. The DOM parser already filled standard fields but these remain empty:

{fields_text}

Candidate data:
{candidate_info}

Looking at the screenshot, return a JSON array of actions for ONLY the unfilled fields:
{{
  "selector": "CSS selector using id, name, or class (NO :contains or jQuery)",
  "action": "fill" | "select" | "skip",
  "value": "value to fill",
  "description": "field description"
}}

Rules:
- Use input[name="..."] or input[id="..."] selectors only
- Skip salary, cover letter, demographic, and "how did you hear" fields
- For open-ended questions, provide a brief professional answer
- Return ONLY the JSON array"""

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
        except Exception as e:
            log.error(f"Vision analysis failed: {e}")
            return 0

        # Execute Vision actions
        filled = 0
        for action in actions:
            if self._execute_vision_action(page, action, job, result):
                filled += 1
        return filled

    def _execute_vision_action(self, page: Page, action: dict, job: dict, result: dict) -> bool:
        """Execute a single Vision-suggested action."""
        try:
            selector = action.get("selector", "")
            act = action.get("action", "")
            value = action.get("value", "")
            desc = action.get("description", "")

            if act == "skip" or not selector:
                return False

            # Sanitize selector
            selector = re.sub(r':contains\([^)]*\)', '', selector)
            selector = re.sub(r':has-text\([^)]*\)', '', selector)
            selector = re.sub(r':visible', '', selector).strip()

            el = page.locator(selector).first
            if not el.is_visible(timeout=2000):
                return False

            if act == "fill":
                if self.notes_client and _is_open_question(desc):
                    answer = self.notes_client.answer_question(
                        desc, job.get("title", ""), job.get("company", "")
                    )
                    if answer:
                        value = answer
                el.clear()
                el.fill(value)
                result["fields"] += 1
                log.info(f"Vision filled '{desc}': {value[:40]}")
                return True

            elif act == "select":
                try:
                    el.select_option(label=value)
                except Exception:
                    el.select_option(value=value)
                result["fields"] += 1
                log.info(f"Vision selected '{desc}': {value}")
                return True

        except Exception as e:
            log.warning(f"Vision action failed ({action.get('description', '')}): {e}")
        return False

    # ---- Navigation ----

    def _click_next_or_submit(self, page: Page) -> bool:
        """Find and click Submit/Next/Continue button."""
        selectors = [
            "button[type='submit']", "input[type='submit']",
            "button >> text=Submit", "button >> text=Next",
            "button >> text=Continue", "button >> text=Save",
            "button >> text=Submit Application",
            "a >> text=Submit", "a >> text=Next", "a >> text=Continue",
            "button.btn-primary", "button.submit-btn",
        ]
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=500):
                    el.scroll_into_view_if_needed()
                    el.click()
                    log.info(f"Clicked next/submit: {sel}")
                    return True
            except Exception:
                continue

        # Fallback: scan all buttons
        try:
            buttons = page.locator("button, input[type='submit']").all()
            for btn in buttons:
                try:
                    text = btn.inner_text(timeout=300).lower().strip()
                    if any(kw in text for kw in ["submit", "next", "continue", "apply", "save"]):
                        btn.scroll_into_view_if_needed()
                        btn.click()
                        log.info(f"Clicked via text scan: '{text}'")
                        return True
                except Exception:
                    continue
        except Exception:
            pass

        return False

    def _check_blockers(self, page: Page) -> str | None:
        """Check for blockers or success. Returns 'success', error string, or None."""
        try:
            page_text = page.inner_text("body").lower()
        except Exception:
            return None

        # Success
        success_phrases = ["application submitted", "thank you for applying",
                           "successfully applied", "application received",
                           "application has been submitted", "you have applied"]
        if any(p in page_text for p in success_phrases):
            return "success"

        # Blockers
        if "captcha" in page_text or "verify you are human" in page_text:
            return "CAPTCHA detected"
        if "please sign in" in page_text[:1000] or "sign in to apply" in page_text[:1000]:
            return "Login wall detected"
        if "this job is no longer available" in page_text or "position has been filled" in page_text:
            return "Job no longer available"

        return None


def _is_open_question(description: str) -> bool:
    """Detect if a form field is an open-ended question needing a story-based answer."""
    indicators = ["why", "describe", "tell us", "explain", "experience with",
                  "how have you", "what is your", "share an example"]
    desc_lower = description.lower()
    return any(ind in desc_lower for ind in indicators)
