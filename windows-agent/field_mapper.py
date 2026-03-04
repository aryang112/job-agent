"""Map candidate profile data to form fields."""

CANDIDATE = {
    "first_name": "Aryan",
    "last_name": "Gupta",
    "email": "aryangupta074@gmail.com",
    "phone": "(443) 253-5169",
    "city": "Nottingham",
    "state": "MD",
    "zip": "21236",
    "country": "United States",
    "citizenship": "US Citizen",
    "work_authorization": "Yes",
    "sponsorship_required": "No",
    "clearance": "Public Trust",
    "linkedin": "",  # User will provide later
    "years_experience": "8",
    "education_level": "Bachelor's",
    "university": "University of Maryland, Baltimore County",
    "degree": "B.S. Financial Economics",
    "graduation_year": "2018",
    "current_title": "Test Lead & Backend SDET",
    "current_company": "GDIT",

    # Work history entries for ATS forms
    "work_history": [
        {
            "company": "GDIT (General Dynamics IT)",
            "title": "Test Lead & Backend SDET",
            "start": "Sep 2023",
            "end": "Present",
            "description": "Led QA for 200+ Spring Boot microservices (FAFSA, 18M+ users), managed 15-20 engineers, reduced defect resolution by 60%, architected Cucumber BDD framework adopted by 4+ teams."
        },
        {
            "company": "Leidos",
            "title": "Sr Automation Engineer",
            "start": "Mar 2022",
            "end": "Sep 2023",
            "description": "Selenium+Java+Cucumber POM framework, REST Assured API automation, CI/CD integration, Allure/ExtentReports dashboards."
        },
        {
            "company": "SEI Investments",
            "title": "QA Engineer",
            "start": "Jan 2021",
            "end": "Feb 2022",
            "description": "Playwright+TypeScript full-stack automation, REST API validation, financial microservices data flow testing."
        },
        {
            "company": "Peraton",
            "title": "QA Automation Engineer",
            "start": "Jul 2019",
            "end": "Dec 2020",
            "description": "Selenium/Cypress/Cucumber BDD, Postman/ReadyAPI API suites, GitLab/Azure DevOps CI, Section 508 accessibility testing."
        },
    ],
}

# Common field name patterns → candidate data key
FIELD_MAP = {
    "first": "first_name",
    "last": "last_name",
    "email": "email",
    "phone": "phone",
    "mobile": "phone",
    "city": "city",
    "state": "state",
    "zip": "zip",
    "postal": "zip",
    "country": "country",
    "authorization": "work_authorization",
    "authorized": "work_authorization",
    "sponsorship": "sponsorship_required",
    "sponsor": "sponsorship_required",
    "clearance": "clearance",
    "linkedin": "linkedin",
    "experience": "years_experience",
    "university": "university",
    "school": "university",
    "degree": "degree",
    "graduation": "graduation_year",
    "title": "current_title",
    "current_company": "current_company",
}


def get_field_value(label: str) -> str | None:
    """Given a form field label, return the best candidate data value."""
    label_lower = label.lower().strip()
    for pattern, key in FIELD_MAP.items():
        if pattern in label_lower:
            return CANDIDATE.get(key, "")
    return None
