export const CANDIDATE = {
  name: "Aryan Gupta",
  email: "aryangupta074@gmail.com",
  phone: "(443) 253-5169",
  location: "Nottingham, MD 21236",
  citizenship: "US Citizen",
  clearance: "Public Trust",
  experience_years: 8,
  title: "Test Lead & Backend SDET",

  skills: [
    "Java", "Spring Boot", "Rest Assured", "Selenium WebDriver", "Playwright", "Cypress",
    "Cucumber BDD", "Gherkin", "TestNG", "JUnit", "Mockito",
    "AWS EKS", "AWS Lambda", "S3", "CloudWatch", "IAM", "EC2",
    "Docker", "Kubernetes", "GitLab CI/CD", "Jenkins", "Git",
    "PostgreSQL", "MySQL", "Spring Data JPA", "SQL",
    "TypeScript", "JavaScript", "Groovy",
    "OpenAPI", "Swagger", "OAuth 2.0", "Kong API Gateway", "REST APIs",
    "JIRA", "Confluence", "Postman", "ReadyAPI", "SoapUI", "SonarQube",
    "Allure Reports", "Extent Reports", "Microservices", "508 Compliance"
  ],

  experience: [
    "GDIT — Test Lead & Backend SDET (Sep 2023–Present): Led QA for 200+ Spring Boot microservices (FAFSA, 18M+ users), managed 15-20 engineers, reduced defect resolution by 60%, architected Cucumber BDD framework adopted by 4+ teams, authored production Java Spring Boot code, managed AWS EKS/IAM/S3/CloudWatch.",
    "Leidos — Sr Automation Engineer (Mar 2022–Sep 2023): Selenium+Java+Cucumber POM framework, REST Assured API automation, CI/CD integration, Allure/ExtentReports dashboards.",
    "SEI Investments — QA Engineer (Jan 2021–Feb 2022): Playwright+TypeScript full-stack automation, REST API validation, financial microservices data flow testing.",
    "Peraton — QA Automation Engineer (Jul 2019–Dec 2020): Selenium/Cypress/Cucumber BDD, Postman/ReadyAPI API suites, GitLab/Azure DevOps CI, Section 508 accessibility testing.",
    "Northrop Grumman — Junior Programmer Analyst (May 2016–Aug 2019): TMS/PFIR modernization, manual + automated API/UI testing, 508-compliant interfaces."
  ],

  education: "B.S. Financial Economics, Minor Information Systems — University of Maryland, Baltimore County (2018)",

  preferences: {
    arrangement: ["Remote"],
    employment_types: ["Full-time W2", "Contract/C2C", "Federal/GovCon", "Part-time/Consulting"],
    location: "Any US Remote",
    min_salary: 130000,
    no_cover_letter: true
  },

  search_queries: [
    "SDET",
    "QA Engineer",
    "QA Automation Engineer",
    "Test Lead",
    "Automation Engineer",
    "Software Engineer in Test",
  ]
};

// Defense prime contractors — used for score boosting
export const DEFENSE_PRIMES = [
  "Booz Allen", "Booz Allen Hamilton",
  "Leidos",
  "SAIC",
  "GDIT", "General Dynamics IT", "General Dynamics",
  "Peraton",
  "Northrop Grumman",
  "Raytheon",
  "ManTech",
  "CACI",
  "Accenture Federal", "Accenture Federal Services",
  "Deloitte Federal", "Deloitte",
  "L3Harris", "L3 Harris",
  "BAE Systems",
  "DXC", "DXC Technology",
  "Maximus",
  "ICF",
  "Amentum",
  "Unison"
];

// Keywords that indicate clearance requirement/preference
export const CLEARANCE_KEYWORDS = [
  "public trust", "secret clearance", "top secret", "ts/sci",
  "security clearance", "clearance required", "clearance preferred",
  "suitability", "naci", "mbi", "bi", "moderate risk",
  "high risk", "position of trust"
];

export const SCORING_SYSTEM_PROMPT = `You are a job fit analyzer for a senior SDET. Return ONLY valid JSON, no markdown, no backticks.

Candidate: ${CANDIDATE.name}, ${CANDIDATE.citizenship}, ${CANDIDATE.clearance} Clearance, ${CANDIDATE.experience_years}+ years
Title: ${CANDIDATE.title}
Skills: ${CANDIDATE.skills.join(", ")}
Experience: ${CANDIDATE.experience.map(e => e.split(":")[0]).join(" | ")}
Preferences: Remote only, Any US, Any employment type (W2, C2C, Federal, Consulting)

Return this exact JSON structure:
{
  "score": <0-100 integer>,
  "verdict": "<STRONG FIT | GOOD FIT | WEAK FIT | NO FIT>",
  "apply_recommendation": "<YES | MAYBE | NO>",
  "match_reasons": ["<reason>", "<reason>", "<reason>"],
  "gaps": ["<gap>"],
  "key_requirements": ["<req1>", "<req2>", "<req3>"],
  "salary_estimate": "<range or N/A>",
  "quick_pitch": "<2 sentences tailored to this specific role>",
  "is_federal": <true if government/federal/GovCon role>,
  "clearance_mentioned": <true if any clearance level mentioned>
}

Score 85+ = STRONG FIT (apply immediately). 70-84 = GOOD FIT. 50-69 = WEAK FIT. Below 50 = NO FIT.

Federal/Defense Scoring Rules:
- Federal/GovCon roles that match skills: boost score. These are high-priority targets.
- Defense prime contractors (Booz Allen, Leidos, SAIC, GDIT, Peraton, Northrop Grumman, Raytheon, ManTech, CACI, etc.) are preferred employers — score generously.
- Public Trust clearance is a strong match for most federal roles.
- Do NOT penalize for salary if not listed or if below preference — many federal roles have strong total comp.

Penalize heavily for: on-site only, requires clearance candidate doesn't hold (TS/SCI, Secret), irrelevant domain (healthcare coding, non-tech).
Reward: Java/Selenium/Playwright, federal/GovCon, AWS, microservices, remote, Public Trust, test leadership.`;
