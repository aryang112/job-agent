"""Detect ATS type from a job URL or page content."""


def detect_ats(url: str) -> str:
    """Determine ATS type from URL patterns."""
    if not url:
        return "unknown"
    u = url.lower()

    if "indeed.com/applystart" in u or ("indeed.com" in u and "/apply" in u):
        return "easy_apply"
    if "myworkdayjobs.com" in u or "workday.com" in u:
        return "workday"
    if "boards.greenhouse.io" in u or "greenhouse.io" in u:
        return "greenhouse"
    if "lever.co" in u or "jobs.lever.co" in u:
        return "lever"
    if "icims.com" in u:
        return "icims"
    if "taleo.net" in u:
        return "taleo"
    if "indeed.com/viewjob" in u:
        return "easy_apply"

    return "custom"


def detect_ats_from_page(page) -> str:
    """Detect ATS type from the current Playwright page."""
    url = page.url.lower()
    ats = detect_ats(url)
    if ats != "custom":
        return ats

    # Check page content for ATS signatures
    try:
        content = page.content()
        if "workday" in content.lower():
            return "workday"
        if "greenhouse" in content.lower():
            return "greenhouse"
        if "lever" in content.lower():
            return "lever"
    except Exception:
        pass

    return "custom"
