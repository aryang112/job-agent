"""Indeed Easy Apply flow using Playwright.

Indeed Easy Apply is a multi-step form hosted on Indeed's own domain.
No external ATS redirect, no Cloudflare — just fill fields and submit.
"""
import os
import random
from playwright.sync_api import Page
from field_mapper import CANDIDATE
from logger import log


def apply_easy(page: Page, job: dict, resume_path: str) -> dict:
    """
    Fill and submit Indeed's Easy Apply form.
    Returns: { success, pages, fields, resume_uploaded, error }
    """
    result = {"success": False, "pages": 0, "fields": 0, "resume_uploaded": False, "error": None}

    try:
        url = job.get("url", "")
        if not url:
            result["error"] = "No job URL"
            return result

        log.info(f"Easy Apply: navigating to {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(random.randint(2000, 4000))
        result["pages"] += 1

        # Check for blockers on initial load
        blocker = _check_blocker(page)
        if blocker:
            result["error"] = blocker
            return result

        # Find and click the Apply button
        clicked = _click_apply_button(page)
        if not clicked:
            result["error"] = "No Easy Apply button found"
            return result

        page.wait_for_timeout(random.randint(2000, 4000))
        result["pages"] += 1

        # Check for blockers after clicking Apply
        blocker = _check_blocker(page)
        if blocker:
            result["error"] = blocker
            return result

        # Process form pages (Indeed can have 2-5 steps)
        max_pages = 8
        for step in range(max_pages):
            log.info(f"Easy Apply step {step + 1}")

            # Fill all visible fields
            fields_filled = _fill_page_fields(page, resume_path, result)
            result["fields"] += fields_filled
            log.info(f"Filled {fields_filled} fields on step {step + 1}")

            # Small human-like delay
            page.wait_for_timeout(random.randint(500, 1500))

            # Try Submit first, then Continue/Next
            if _click_button(page, ["Submit your application", "Submit application",
                                     "Submit", "Apply"]):
                page.wait_for_timeout(3000)
                result["pages"] += 1
                if _check_success(page):
                    result["success"] = True
                    log.info("Easy Apply: application submitted!")
                    return result
                # Might be another step after "submit"
                continue

            elif _click_button(page, ["Continue", "Next", "Review"]):
                page.wait_for_timeout(random.randint(2000, 3000))
                result["pages"] += 1

                blocker = _check_blocker(page)
                if blocker:
                    result["error"] = blocker
                    return result
                continue

            else:
                # No button found — check if we succeeded anyway
                if _check_success(page):
                    result["success"] = True
                    return result
                result["error"] = "No submit or continue button found"
                return result

        result["error"] = "Too many form pages"
        return result

    except Exception as e:
        result["error"] = str(e)[:200]
        return result


def _click_apply_button(page: Page) -> bool:
    """Find and click the Indeed Apply button."""
    # Indeed-specific selectors
    selectors = [
        "#indeedApplyButton",
        "button[id*='applyButton']",
        "button[class*='apply']",
        "a[class*='apply']",
    ]
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=1000):
                el.scroll_into_view_if_needed()
                el.click()
                log.info(f"Clicked Apply button: {sel}")
                return True
        except Exception:
            continue

    # Fallback: text-based search
    for text in ["Apply now", "Easy Apply", "Apply", "Apply on company site"]:
        try:
            el = page.locator(f"button >> text={text}").first
            if el.is_visible(timeout=500):
                el.click()
                log.info(f"Clicked Apply button: '{text}'")
                return True
        except Exception:
            pass
        try:
            el = page.locator(f"a >> text={text}").first
            if el.is_visible(timeout=500):
                el.click()
                log.info(f"Clicked Apply link: '{text}'")
                return True
        except Exception:
            pass

    # Last resort: scan all buttons/links
    for tag in ["button", "a"]:
        try:
            elements = page.locator(tag).all()
            for el in elements:
                try:
                    btn_text = el.inner_text(timeout=300).strip().lower()
                    if "apply" in btn_text and len(btn_text) < 30:
                        el.scroll_into_view_if_needed()
                        el.click()
                        log.info(f"Clicked via scan: '{btn_text}'")
                        return True
                except Exception:
                    continue
        except Exception:
            continue

    return False


def _click_button(page: Page, texts: list[str]) -> bool:
    """Click a button matching one of the given texts."""
    for text in texts:
        try:
            el = page.locator(f"button >> text={text}").first
            if el.is_visible(timeout=1000):
                el.scroll_into_view_if_needed()
                el.click()
                log.info(f"Clicked: '{text}'")
                return True
        except Exception:
            pass

    # Try submit button type
    try:
        el = page.locator("button[type='submit'], input[type='submit']").first
        if el.is_visible(timeout=500):
            el.scroll_into_view_if_needed()
            el.click()
            log.info("Clicked submit button (type=submit)")
            return True
    except Exception:
        pass

    return False


def _fill_page_fields(page: Page, resume_path: str, result: dict) -> int:
    """Fill all visible form fields on the current Indeed page."""
    filled = 0

    # Resume upload
    try:
        file_input = page.locator('input[type="file"]').first
        if file_input.is_visible(timeout=1000) and os.path.exists(resume_path):
            file_input.set_input_files(resume_path)
            result["resume_uploaded"] = True
            filled += 1
            log.info("Uploaded resume")
    except Exception as e:
        log.warning(f"Resume upload: {e}")

    # Standard text fields
    field_mappings = [
        (["firstName", "first_name", "first-name", "applicant.name"], CANDIDATE["first_name"]),
        (["lastName", "last_name", "last-name"], CANDIDATE["last_name"]),
        (["email", "emailAddress", "email-address"], CANDIDATE["email"]),
        (["phoneNumber", "phone", "mobile", "telephone", "phone-number"], CANDIDATE["phone"]),
        (["city", "location-city"], CANDIDATE["city"]),
        (["postalCode", "zip", "zipCode", "postal-code"], CANDIDATE["zip"]),
    ]

    for patterns, value in field_mappings:
        for pattern in patterns:
            try:
                # Try by name, then id, then placeholder
                for attr in ["name", "id"]:
                    inp = page.locator(f'input[{attr}*="{pattern}" i]').first
                    if inp.is_visible(timeout=300):
                        current = inp.input_value()
                        if not current.strip():  # Don't overwrite pre-filled
                            inp.clear()
                            inp.fill(value)
                            filled += 1
                            log.info(f"Filled {pattern}: {value}")
                        break
            except Exception:
                continue

    # Handle common dropdowns
    _try_select(page, ["authorized", "work_auth", "eligible"], "Yes")
    _try_select(page, ["sponsor", "visa"], "No")
    _try_select(page, ["clearance"], "Public Trust")

    # Handle radio buttons (Yes/No questions)
    _try_radio(page, ["authorized", "legally", "eligible"], "yes")
    _try_radio(page, ["sponsor", "visa"], "no")

    return filled


def _try_select(page: Page, patterns: list[str], value: str):
    """Try to set a dropdown value."""
    for pattern in patterns:
        try:
            sel = page.locator(f'select[name*="{pattern}" i], select[id*="{pattern}" i]').first
            if sel.is_visible(timeout=300):
                try:
                    sel.select_option(label=value)
                except Exception:
                    sel.select_option(value=value.lower())
                log.info(f"Selected {pattern}: {value}")
                return
        except Exception:
            continue


def _try_radio(page: Page, patterns: list[str], value: str):
    """Try to click a radio button for Yes/No questions."""
    for pattern in patterns:
        try:
            radio = page.locator(f'input[type="radio"][name*="{pattern}" i][value*="{value}" i]').first
            if radio.is_visible(timeout=300):
                radio.click()
                log.info(f"Radio {pattern}: {value}")
                return
        except Exception:
            continue


def _check_success(page: Page) -> bool:
    """Check if the application was submitted."""
    try:
        text = page.inner_text("body").lower()
        return any(p in text for p in [
            "application has been submitted",
            "successfully applied",
            "application sent",
            "thank you for applying",
            "you have applied",
            "your application was sent",
        ])
    except Exception:
        return False


def _check_blocker(page: Page) -> str | None:
    """Check for Cloudflare, CAPTCHA, login walls."""
    try:
        text = page.inner_text("body").lower()
    except Exception:
        return None

    if any(p in text for p in ["verify you are human", "cloudflare", "checking your browser"]):
        return "Cloudflare verification required"
    if "captcha" in text:
        return "CAPTCHA detected"
    if "sign in" in text[:500] and "to apply" in text[:1000]:
        return "Login wall detected"
    if "this job is no longer available" in text or "position has been filled" in text:
        return "Job no longer available"
    return None
