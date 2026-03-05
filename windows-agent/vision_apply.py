"""Hybrid DOM + AI ATS form filling for non-Indeed applications.

Strategy: DOM-first, Vision-fallback.
Phase 1: Scrape ALL clickable elements from DOM, ask Claude to pick the right button (1 cheap text call).
Phase 2: Parse DOM to identify form fields and fill them with candidate data (0 API calls).
Phase 3: Only use Claude Vision for fields the DOM parser can't figure out.
"""
import base64
import json
import math
import random
import re
import time
import anthropic
from playwright.sync_api import Page, Locator
from field_mapper import CANDIDATE, get_field_value
from logger import log

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
    def __init__(self, api_key: str, notes_client=None, capsolver_key: str = ""):
        self.claude = anthropic.Anthropic(api_key=api_key)
        self.notes_client = notes_client
        self.capsolver_key = capsolver_key

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

            # --- Phase 0: Check for Cloudflare on initial load ---
            blocker = self._check_blockers(page, job)
            if blocker == "success":
                result["success"] = True
                return result
            if blocker:
                result["error"] = blocker
                return result

            # --- Phase 1: Find and click Apply button via DOM ---
            if not self._is_on_form(page):
                clicked = self._click_apply_button(page)
                if not clicked:
                    result["error"] = "Could not find Apply button via DOM"
                    return result
                page.wait_for_timeout(3000)
                result["pages"] += 1

                # Cloudflare check after navigation (Apply button may redirect)
                blocker = self._check_blockers(page, job)
                if blocker == "success":
                    result["success"] = True
                    return result
                if blocker:
                    result["error"] = blocker
                    return result

            # --- Phase 2+3: Fill form (DOM-first, Vision-fallback) ---
            max_pages = 10
            for page_num in range(max_pages):
                # Check blockers
                blocker = self._check_blockers(page, job)
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
                    if self._check_blockers(page, job) == "success":
                        result["success"] = True
                        return result
                    result["error"] = "Could not find Next/Submit button"
                    return result

                page.wait_for_timeout(3000)
                result["pages"] += 1

                # Cloudflare/blocker check after every page navigation
                blocker = self._check_blockers(page, job)
                if blocker == "success":
                    result["success"] = True
                    return result
                if blocker:
                    result["error"] = blocker
                    return result

            result["error"] = "Max form pages reached"
            return result

        except Exception as e:
            result["error"] = str(e)[:200]
            return result

    # ---- Phase 1: Smart Button Discovery ----

    def _scrape_clickables(self, page: Page) -> list[dict]:
        """Extract all visible clickable elements (buttons, links) from the DOM."""
        clickables = []
        try:
            items = page.evaluate("""() => {
                const results = [];
                const elements = document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"], [onclick]');
                for (const el of elements) {
                    // Skip invisible
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

                    const text = (el.innerText || el.value || '').trim().substring(0, 80);
                    if (!text) continue;

                    // Build a unique selector
                    let selector = '';
                    if (el.id) {
                        selector = '#' + el.id;
                    } else if (el.name) {
                        selector = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
                    } else if (el.className && typeof el.className === 'string') {
                        const cls = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
                        if (cls) selector = el.tagName.toLowerCase() + '.' + cls;
                    }
                    if (!selector) {
                        selector = el.tagName.toLowerCase();
                    }

                    results.push({
                        index: results.length,
                        tag: el.tagName.toLowerCase(),
                        text: text,
                        href: el.href || '',
                        selector: selector,
                        ariaLabel: el.getAttribute('aria-label') || '',
                        classes: el.className || '',
                    });
                }
                return results.slice(0, 50);  // Cap at 50 to keep prompt small
            }""")
            clickables = items or []
        except Exception as e:
            log.warning(f"Error scraping clickables: {e}")
        return clickables

    def _ask_claude_pick_button(self, clickables: list[dict], purpose: str) -> dict | None:
        """Ask Claude (text-only, no vision) to pick the right button from a list."""
        if not clickables:
            return None

        # Format the list for Claude
        choices = []
        for c in clickables:
            line = f"[{c['index']}] <{c['tag']}> \"{c['text']}\""
            if c.get('href'):
                line += f"  href={c['href'][:80]}"
            if c.get('ariaLabel'):
                line += f"  aria-label=\"{c['ariaLabel']}\""
            choices.append(line)
        choices_text = "\n".join(choices)

        prompt = f"""Here are all the clickable elements on a job posting page:

{choices_text}

I want to: {purpose}

Which element should I click? Return ONLY a JSON object:
{{"index": <number>, "reason": "<brief reason>"}}

If none of these elements match, return: {{"index": -1, "reason": "no matching element found"}}"""

        try:
            response = self.claude.messages.create(
                model="claude-haiku-4-5-20251001",  # Fast + cheap for text-only
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}]
            )
            text = response.content[0].text.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            result = json.loads(text)
            idx = result.get("index", -1)
            reason = result.get("reason", "")
            if idx >= 0 and idx < len(clickables):
                log.info(f"Claude picked button [{idx}]: \"{clickables[idx]['text']}\" — {reason}")
                return clickables[idx]
            else:
                log.warning(f"Claude found no matching button: {reason}")
                return None
        except Exception as e:
            log.error(f"Claude button picker failed: {e}")
            return None

    def _click_apply_button(self, page: Page) -> bool:
        """Scrape all clickable elements, ask Claude which one is the Apply button, click it."""
        clickables = self._scrape_clickables(page)
        log.info(f"Found {len(clickables)} clickable elements on page")

        if not clickables:
            log.warning("No clickable elements found")
            return False

        picked = self._ask_claude_pick_button(
            clickables,
            "Click the button/link that starts the job application process (e.g. 'Apply Now', 'Apply', 'Quick Apply', 'Submit Resume', 'Start Application', or similar). NOT 'Save Job', 'Share', 'Sign In', 'Report', or navigation links."
        )

        if not picked:
            return False

        # Click using the selector, with fallback to text matching
        return self._click_picked_element(page, picked)

    def _click_picked_element(self, page: Page, picked: dict) -> bool:
        """Click the element Claude picked, trying multiple strategies."""
        selector = picked.get("selector", "")
        text = picked.get("text", "")
        tag = picked.get("tag", "")

        # Strategy 1: Direct selector
        if selector:
            try:
                el = page.locator(selector).first
                if el.is_visible(timeout=1000):
                    el.scroll_into_view_if_needed()
                    el.click()
                    log.info(f"Clicked via selector: {selector}")
                    return True
            except Exception:
                pass

        # Strategy 2: Playwright text selector
        if text:
            try:
                el = page.locator(f"{tag} >> text={text}").first
                if el.is_visible(timeout=1000):
                    el.scroll_into_view_if_needed()
                    el.click()
                    log.info(f"Clicked via text: '{text}'")
                    return True
            except Exception:
                pass

            # Strategy 3: Exact text match across all same-tag elements
            try:
                elements = page.locator(tag).all()
                for el in elements:
                    try:
                        el_text = el.inner_text(timeout=300).strip()
                        if el_text == text:
                            el.scroll_into_view_if_needed()
                            el.click()
                            log.info(f"Clicked via exact text match: '{text}'")
                            return True
                    except Exception:
                        continue
            except Exception:
                pass

        log.warning(f"Could not click picked element: {selector} / '{text}'")
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
        """Scrape clickable elements and ask Claude which is the Next/Submit button."""
        # Quick check: try obvious submit button first (free, no API call)
        try:
            submit = page.locator("button[type='submit'], input[type='submit']").first
            if submit.is_visible(timeout=500):
                submit.scroll_into_view_if_needed()
                submit.click()
                log.info("Clicked submit button (type=submit)")
                return True
        except Exception:
            pass

        # Smart approach: scrape + ask Claude
        clickables = self._scrape_clickables(page)
        if not clickables:
            return False

        picked = self._ask_claude_pick_button(
            clickables,
            "Click the button that submits the form or goes to the next step (e.g. 'Submit', 'Submit Application', 'Next', 'Continue', 'Save and Continue', 'Review', 'Send Application'). NOT 'Cancel', 'Back', 'Save Draft', 'Sign In', or navigation links."
        )

        if not picked:
            return False

        return self._click_picked_element(page, picked)

    def _human_mouse_move(self, page: Page, target_x: float, target_y: float):
        """Simulate human-like mouse movement with a curved path and variable speed."""
        # Start from a random spot (or current position approximation)
        start_x = random.randint(100, 400)
        start_y = random.randint(100, 300)

        # Generate a bezier-ish curve with some noise
        steps = random.randint(25, 45)
        for i in range(steps + 1):
            t = i / steps
            # Ease-in-out curve
            t_smooth = t * t * (3 - 2 * t)
            # Add slight random wobble
            wobble_x = random.gauss(0, 2)
            wobble_y = random.gauss(0, 1.5)
            # Bezier midpoint offset for natural arc
            mid_offset_x = random.uniform(-30, 30) * math.sin(math.pi * t)
            mid_offset_y = random.uniform(-20, 20) * math.sin(math.pi * t)

            x = start_x + (target_x - start_x) * t_smooth + mid_offset_x + wobble_x
            y = start_y + (target_y - start_y) * t_smooth + mid_offset_y + wobble_y

            page.mouse.move(x, y)
            # Variable delay — slower at start/end, faster in middle
            delay = random.uniform(5, 20) if 0.2 < t < 0.8 else random.uniform(15, 40)
            page.wait_for_timeout(delay)

    def _vision_find_checkbox(self, page: Page) -> tuple[float, float] | None:
        """Use Claude Vision to find the exact pixel coordinates of the Cloudflare checkbox."""
        screenshot = page.screenshot(type="png")
        b64_image = base64.b64encode(screenshot).decode()

        try:
            response = self.claude.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64_image}},
                        {"type": "text", "text": """Look at this screenshot. There is a Cloudflare "Verify you are human" challenge on this page.

Find the checkbox, button, or clickable widget that I need to click to verify.

IMPORTANT: The viewport is 1280x900 pixels. Return the PIXEL COORDINATES of where to click.

Return ONLY this JSON (no explanation, no markdown):
{"x": 123, "y": 456, "description": "the checkbox"}

If you truly cannot find any clickable verification element, return:
{"x": -1, "y": -1, "description": "not found"}"""}
                    ]
                }]
            )
            text = response.content[0].text.strip()
            # Clean up common Claude formatting issues
            text = text.replace("```json", "").replace("```", "").strip()
            # Try to extract JSON from the response even if there's surrounding text
            json_match = re.search(r'\{[^}]+\}', text)
            if not json_match:
                log.warning(f"Vision returned non-JSON: {text[:100]}")
                return None

            result = json.loads(json_match.group())
            x, y = result.get("x", -1), result.get("y", -1)
            desc = result.get("description", "")
            if x > 0 and y > 0:
                log.info(f"Vision found Cloudflare checkbox at ({x}, {y}): {desc}")
                return (x, y)
            else:
                log.warning(f"Vision couldn't find checkbox: {desc}")
                return None
        except json.JSONDecodeError as e:
            log.warning(f"Vision returned invalid JSON: {e}")
            return None
        except Exception as e:
            log.error(f"Vision Cloudflare detection failed: {e}")
            return None

    def _is_cloudflare_present(self, page: Page) -> bool:
        """Quick check if Cloudflare challenge is on the page."""
        try:
            page_text = page.inner_text("body").lower()
            return any(p in page_text for p in [
                "verify you are human", "checking your browser",
                "just a moment", "cloudflare",
            ])
        except Exception:
            return False

    def _wait_for_cloudflare(self, page: Page, use_capsolver: bool = False) -> bool:
        """Handle Cloudflare Turnstile: Vision+mouse first, CapSolver fallback for high-value jobs."""
        log.info("Cloudflare challenge detected — attempting to solve...")
        page.wait_for_timeout(2000)

        # --- Attempt 1-3: Vision + human mouse ---
        for attempt in range(3):
            coords = self._vision_find_checkbox(page)
            if not coords:
                page.wait_for_timeout(2000)
                continue

            x, y = coords
            x += random.uniform(-3, 3)
            y += random.uniform(-3, 3)

            # Human-like mouse movement to the checkbox
            self._human_mouse_move(page, x, y)
            page.wait_for_timeout(random.randint(100, 400))
            page.mouse.click(x, y)
            log.info(f"Clicked Cloudflare checkbox at ({x:.0f}, {y:.0f}) — attempt {attempt + 1}")

            page.wait_for_timeout(5000)

            if not self._is_cloudflare_present(page):
                log.info(f"Cloudflare cleared via Vision+mouse on attempt {attempt + 1}")
                return True

            log.warning(f"Cloudflare still present after attempt {attempt + 1}")
            page.wait_for_timeout(2000)

        # --- Attempt 4: CapSolver paid fallback (only if enabled + high-value) ---
        if use_capsolver and self.capsolver_key:
            log.info("Trying CapSolver as paid fallback...")
            if self._solve_with_capsolver(page):
                return True

        log.warning("Cloudflare challenge could not be solved")
        return False

    def _solve_with_capsolver(self, page: Page) -> bool:
        """Use CapSolver API to solve Cloudflare Turnstile. Returns True if solved."""
        try:
            import requests

            # Find the Turnstile sitekey from the page
            sitekey = page.evaluate("""() => {
                const el = document.querySelector('[data-sitekey]') ||
                           document.querySelector('iframe[src*="turnstile"]');
                if (el) return el.getAttribute('data-sitekey') || '';
                // Try to extract from iframe src
                const iframes = document.querySelectorAll('iframe');
                for (const f of iframes) {
                    const match = (f.src || '').match(/sitekey=([^&]+)/);
                    if (match) return match[1];
                }
                return '';
            }""")

            if not sitekey:
                log.warning("CapSolver: could not find Turnstile sitekey")
                return False

            page_url = page.url
            log.info(f"CapSolver: solving Turnstile (sitekey={sitekey[:20]}...)")

            # Create task
            resp = requests.post("https://api.capsolver.com/createTask", json={
                "clientKey": self.capsolver_key,
                "task": {
                    "type": "AntiTurnstileTaskProxyLess",
                    "websiteURL": page_url,
                    "websiteKey": sitekey,
                }
            }, timeout=10)
            task_data = resp.json()
            task_id = task_data.get("taskId")
            if not task_id:
                log.warning(f"CapSolver: failed to create task: {task_data}")
                return False

            # Poll for result (max 60s)
            for _ in range(30):
                time.sleep(2)
                resp = requests.post("https://api.capsolver.com/getTaskResult", json={
                    "clientKey": self.capsolver_key,
                    "taskId": task_id,
                }, timeout=10)
                result = resp.json()
                status = result.get("status")
                if status == "ready":
                    token = result.get("solution", {}).get("token", "")
                    if token:
                        # Inject the token into Turnstile callback
                        page.evaluate(f"""(token) => {{
                            // Try standard Turnstile callback
                            if (window.turnstile) {{
                                const widgets = document.querySelectorAll('[data-sitekey]');
                                widgets.forEach(w => {{
                                    const id = w.getAttribute('data-turnstile-id') || w.id;
                                    if (id) window.turnstile.execute(id);
                                }});
                            }}
                            // Inject into hidden input
                            const inputs = document.querySelectorAll('input[name*="turnstile"], input[name*="cf-"], input[name="cf-turnstile-response"]');
                            inputs.forEach(i => {{ i.value = token; }});
                            // Try callback function
                            if (typeof window._cf_chl_opt !== 'undefined') {{
                                const form = document.querySelector('form');
                                if (form) form.submit();
                            }}
                        }}""", token)
                        log.info("CapSolver: token injected successfully")
                        page.wait_for_timeout(3000)

                        if not self._is_cloudflare_present(page):
                            log.info("CapSolver: Cloudflare cleared!")
                            return True
                        log.warning("CapSolver: token injected but challenge persists")
                        return False

                elif status == "failed":
                    log.warning(f"CapSolver: task failed: {result}")
                    return False

            log.warning("CapSolver: timed out")
            return False

        except ImportError:
            log.warning("CapSolver: 'requests' package not installed")
            return False
        except Exception as e:
            log.error(f"CapSolver failed: {e}")
            return False

    def _check_blockers(self, page: Page, job: dict = None) -> str | None:
        """Check for blockers or success. Returns 'success', error string, or None.
        Runs Cloudflare check after every navigation."""
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

        # Cloudflare Turnstile — try to solve it
        if self._is_cloudflare_present(page):
            # Use CapSolver only for high-value jobs (score >= 85)
            job_score = (job or {}).get("score", 0) or 0
            use_capsolver = job_score >= 85
            if use_capsolver and self.capsolver_key:
                log.info(f"High-value job (score={job_score}) — CapSolver enabled as fallback")
            if self._wait_for_cloudflare(page, use_capsolver=use_capsolver):
                return None  # Cleared
            return "Cloudflare challenge (not auto-resolved)"

        # Other CAPTCHAs (reCAPTCHA etc.)
        if "captcha" in page_text:
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
