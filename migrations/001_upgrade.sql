-- Migration 001: Upgrade schema for full job agent pipeline
-- Run this in Supabase SQL Editor manually

-- ============================================
-- 1. Add new columns to jobs table
-- ============================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_federal boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_defense_prime boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS clearance_mentioned boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_type text;  -- easy_apply | workday | greenhouse | lever | icims | taleo | custom | unknown
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queued_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS agent_log text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_notes text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;

-- ============================================
-- 2. Create application_log table
-- ============================================
CREATE TABLE IF NOT EXISTS application_log (
  id serial PRIMARY KEY,
  job_id text REFERENCES jobs(id) ON DELETE CASCADE,
  attempted_at timestamptz DEFAULT now(),
  success boolean DEFAULT false,
  ats_type text,
  failure_reason text,
  pages_navigated integer DEFAULT 0,
  fields_filled integer DEFAULT 0,
  resume_uploaded boolean DEFAULT false
);

-- ============================================
-- 3. Create notes table
-- ============================================
CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  category text NOT NULL,
  title text NOT NULL,
  story text NOT NULL,
  keywords text[] DEFAULT '{}',
  last_used timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- 4. Add jobs_queued to scan_log
-- ============================================
ALTER TABLE scan_log ADD COLUMN IF NOT EXISTS jobs_queued integer DEFAULT 0;

-- ============================================
-- 5. New indexes
-- ============================================
CREATE INDEX IF NOT EXISTS jobs_queued_at_idx ON jobs(queued_at) WHERE queued_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_is_federal_idx ON jobs(is_federal) WHERE is_federal = true;
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company);

-- ============================================
-- 6. Seed notes with 4 stories from resume
-- ============================================
INSERT INTO notes (category, title, story, keywords) VALUES
(
  'leadership',
  'Led QA for FAFSA serving 18M+ users',
  'At GDIT, I served as Test Lead for the Federal Student Aid (FAFSA) modernization program. I managed 15-20 QA engineers across multiple scrum teams and was responsible for quality across 200+ Spring Boot microservices. I architected a Cucumber BDD test framework that was adopted by 4+ teams, standardizing our approach to test automation. I also authored production Java Spring Boot code alongside my QA duties. Through process improvements and framework standardization, we reduced defect resolution time by 60%. I managed AWS infrastructure including EKS, IAM, S3, and CloudWatch for our test environments.',
  ARRAY['leadership', 'test lead', 'FAFSA', 'federal', 'BDD', 'Spring Boot', 'AWS', 'microservices', 'team management']
),
(
  'automation',
  'Built enterprise Selenium + REST Assured framework at Leidos',
  'At Leidos, I designed and built a comprehensive test automation framework using Selenium WebDriver with Java and Cucumber BDD for UI testing, plus REST Assured for API validation. I implemented the Page Object Model pattern for maintainability and integrated the framework into our CI/CD pipeline. I created Allure and ExtentReports dashboards that gave stakeholders real-time visibility into test results. This framework became the standard for our federal contract program and significantly reduced manual regression testing time.',
  ARRAY['automation', 'Selenium', 'REST Assured', 'Java', 'Cucumber', 'CI/CD', 'Leidos', 'federal']
),
(
  'technical',
  'Full-stack Playwright automation at SEI Investments',
  'At SEI Investments, I built a full-stack test automation solution using Playwright with TypeScript. I automated both UI and API testing for financial microservices, validating complex data flows between services. I designed the test architecture to handle the intricacies of financial data validation, ensuring accuracy in transaction processing and reporting. This was my first deep dive into TypeScript and modern testing frameworks, and the solution significantly improved our release confidence.',
  ARRAY['Playwright', 'TypeScript', 'API testing', 'financial', 'microservices', 'full-stack']
),
(
  'compliance',
  'Section 508 accessibility testing and CI automation',
  'Across multiple federal contracts (Peraton and Northrop Grumman), I specialized in Section 508 compliance testing. I built automated accessibility test suites using Selenium and Cypress with Cucumber BDD, integrating them into GitLab and Azure DevOps CI pipelines. I also created Postman and ReadyAPI API test suites for backend validation. At Northrop Grumman, I contributed to TMS and PFIR system modernization, ensuring all new interfaces met federal accessibility standards. This experience gave me deep understanding of federal compliance requirements.',
  ARRAY['508 compliance', 'accessibility', 'federal', 'Peraton', 'Northrop Grumman', 'Cypress', 'CI/CD']
)
ON CONFLICT DO NOTHING;
