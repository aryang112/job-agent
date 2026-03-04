"""Indeed Easy Apply flow using Playwright."""
import os
from playwright.sync_api import Page
from field_mapper import CANDIDATE
from logger import log


def apply_easy(page: Page, job: dict, resume_path: str) -> dict:
    """
    Fill and submit Indeed's Easy Apply form.
    Returns: { success: bool, pages: int, fields: int, resume_uploaded: bool, error: str|None }
    """
    result = {"success": False, "pages": 0, "fields": 0, "resume_uploaded": False, "error": None}

    try:
        url = job.get("url", "")
        if not url:
            result["error"] = "No job URL"
            return result

        # Navigate to job page
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        result["pages"] += 1

        # Click "Apply now" or "Easy Apply" button
        apply_btn = page.locator('button:has-text("Apply now"), button:has-text("Easy Apply"), a:has-text("Apply now")').first
        if not apply_btn.is_visible(timeout=5000):
            result["error"] = "No Easy Apply button found"
            return result

        apply_btn.click()
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        result["pages"] += 1

        # Process form pages (Indeed can have multiple steps)
        max_pages = 8
        for _ in range(max_pages):
            fields_filled = _fill_page_fields(page, resume_path, result)
            result["fields"] += fields_filled

            # Look for continue/next/submit button
            submit_btn = page.locator('button:has-text("Submit"), button:has-text("Apply"), button[type="submit"]').first
            continue_btn = page.locator('button:has-text("Continue"), button:has-text("Next")').first

            if submit_btn.is_visible(timeout=2000):
                submit_btn.click()
                page.wait_for_timeout(3000)
                result["pages"] += 1

                # Check for success indicators
                if _check_success(page):
                    result["success"] = True
                    return result
                else:
                    # Might be another page
                    continue

            elif continue_btn.is_visible(timeout=2000):
                continue_btn.click()
                page.wait_for_load_state("domcontentloaded", timeout=10000)
                result["pages"] += 1
            else:
                result["error"] = "No submit or continue button found"
                return result

        result["error"] = "Too many form pages"
        return result

    except Exception as e:
        result["error"] = str(e)[:200]
        return result


def _fill_page_fields(page: Page, resume_path: str, result: dict) -> int:
    """Fill all visible form fields on the current page. Returns count of fields filled."""
    filled = 0

    # Resume upload
    file_input = page.locator('input[type="file"]').first
    if file_input.is_visible(timeout=1000) and os.path.exists(resume_path):
        try:
            file_input.set_input_files(resume_path)
            result["resume_uploaded"] = True
            filled += 1
            log.info("Uploaded resume")
        except Exception as e:
            log.warning(f"Resume upload failed: {e}")

    # Text inputs
    for field_name, value in [
        ("firstName", CANDIDATE["first_name"]),
        ("lastName", CANDIDATE["last_name"]),
        ("email", CANDIDATE["email"]),
        ("phoneNumber", CANDIDATE["phone"]),
        ("phone", CANDIDATE["phone"]),
        ("city", CANDIDATE["city"]),
        ("postalCode", CANDIDATE["zip"]),
    ]:
        inp = page.locator(f'input[name*="{field_name}" i], input[id*="{field_name}" i]').first
        if inp.is_visible(timeout=500):
            try:
                inp.clear()
                inp.fill(value)
                filled += 1
            except Exception:
                pass

    # Handle common select dropdowns
    # Work authorization: Yes
    _select_option(page, "authorized", "Yes", filled)
    _select_option(page, "sponsorship", "No", filled)

    # Skip salary fields (leave blank)
    # Skip cover letter fields

    return filled


def _select_option(page: Page, name_pattern: str, value: str, filled: int):
    """Try to select an option in a dropdown matching the pattern."""
    try:
        sel = page.locator(f'select[name*="{name_pattern}" i], select[id*="{name_pattern}" i]').first
        if sel.is_visible(timeout=500):
            sel.select_option(label=value)
    except Exception:
        pass


def _check_success(page: Page) -> bool:
    """Check if the application was submitted successfully."""
    success_indicators = [
        "application has been submitted",
        "successfully applied",
        "application sent",
        "thank you for applying",
        "you have applied",
    ]
    try:
        text = page.inner_text("body").lower()
        return any(indicator in text for indicator in success_indicators)
    except Exception:
        return False
