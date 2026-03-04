import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { CANDIDATE, SCORING_SYSTEM_PROMPT, DEFENSE_PRIMES, CLEARANCE_KEYWORDS } from "@/lib/profile";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Search jobs via JSearch (RapidAPI)
async function searchJobs(query: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      query: `${query} remote`,
      page: "1",
      num_pages: "1",
      date_posted: "week",
      remote_jobs_only: "true",
      country: "US",
    });
    const url = `https://jsearch.p.rapidapi.com/search?${params}`;
    console.log(`[scan] JSearch: "${query}"`);

    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY || "",
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
    });

    if (!res.ok) {
      console.error(`[scan] JSearch returned ${res.status} for "${query}"`);
      return [];
    }

    const data = await res.json();
    const results = data?.data || [];
    console.log(`[scan] JSearch returned ${results.length} jobs for "${query}"`);

    return results.map((r: any) => ({
      job_id: r.job_id || `${r.job_title}-${r.employer_name}`.replace(/\s+/g, "-").toLowerCase(),
      title: r.job_title,
      company: r.employer_name,
      location: r.job_city ? `${r.job_city}, ${r.job_state}` : (r.job_is_remote ? "Remote" : "Unknown"),
      salary: r.job_min_salary && r.job_max_salary
        ? `$${r.job_min_salary.toLocaleString()}–$${r.job_max_salary.toLocaleString()}`
        : null,
      url: r.job_apply_link || r.job_google_link || null,
      description: (r.job_description || "").slice(0, 5000),
      search_query: query,
    }));
  } catch (err: any) {
    console.error(`[scan] JSearch failed for "${query}":`, err?.message || err);
    return [];
  }
}

// Score a job against candidate profile using Claude
async function scoreJob(job: any): Promise<any> {
  try {
    const jobText = `
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "Not specified"}
Salary: ${job.salary || "Not listed"}
Description: ${(job.description || "").slice(0, 3000)}
    `.trim();

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: SCORING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: jobText }]
    });

    const text = (response.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Check if company name matches a defense prime contractor
function isDefensePrime(company: string): boolean {
  const lower = company.toLowerCase();
  return DEFENSE_PRIMES.some(prime => lower.includes(prime.toLowerCase()));
}

// Check if description mentions clearance keywords
function hasClearanceKeywords(description: string): boolean {
  const lower = (description || "").toLowerCase();
  return CLEARANCE_KEYWORDS.some(kw => lower.includes(kw));
}

// Detect ATS type from URL
function detectAtsType(url: string): string {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("indeed.com/applystart") || u.includes("indeed.com/viewjob")) return "easy_apply";
  if (u.includes("myworkdayjobs.com") || u.includes("workday.com")) return "workday";
  if (u.includes("boards.greenhouse.io") || u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co") || u.includes("jobs.lever.co")) return "lever";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("taleo.net")) return "taleo";
  return "unknown";
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const isManual = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isLoggedIn = req.cookies.get("auth_token")?.value === process.env.AUTH_SECRET;

  if (!isVercelCron && !isManual && !isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RAPIDAPI_KEY) {
    return NextResponse.json({ error: "RAPIDAPI_KEY not configured" }, { status: 500 });
  }

  const results = { jobs_found: 0, jobs_new: 0, jobs_queued: 0, queries_run: [] as string[] };
  const allJobs: any[] = [];

  // Run all search queries
  for (const query of CANDIDATE.search_queries) {
    results.queries_run.push(query);
    const jobs = await searchJobs(query);
    allJobs.push(...jobs);
    // Respect rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  results.jobs_found = allJobs.length;

  // Deduplicate by job_id
  const seen = new Set<string>();
  const unique = allJobs.filter(j => {
    const key = j.job_id || `${j.title}-${j.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Check which ones are already in DB
  const ids = unique.map(j => j.job_id).filter(Boolean);
  const { data: existing } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .in("id", ids);
  const existingIds = new Set((existing || []).map((r: any) => r.id));

  const newJobs = unique.filter(j => !existingIds.has(j.job_id));

  // Score and insert new jobs
  for (const job of newJobs) {
    const analysis = await scoreJob(job);
    if (!analysis) continue;

    let score = analysis.score || 0;
    const company = job.company || "";
    const description = job.description || "";

    // Server-side federal detection
    const defensePrime = isDefensePrime(company);
    const federal = defensePrime || analysis.is_federal === true;
    const clearanceMentioned = hasClearanceKeywords(description) || analysis.clearance_mentioned === true;
    const atsType = detectAtsType(job.url || "");

    // Score boosts for defense/federal
    if (defensePrime) {
      score = Math.max(score + 20, 80);
    } else if (federal) {
      score = Math.max(score + 15, 75);
    }
    if (clearanceMentioned) {
      score = Math.min(score + 10, 100);
    }

    // Discard below 60
    if (score < 60) continue;

    // Auto-status assignment
    let status = "new";
    let queuedAt: string | null = null;

    if (score >= 85) {
      status = "queued_to_apply";
      queuedAt = new Date().toISOString();
      results.jobs_queued++;
    } else if (score >= 75 && federal) {
      status = "queued_to_apply";
      queuedAt = new Date().toISOString();
      results.jobs_queued++;
    }

    await supabaseAdmin.from("jobs").upsert({
      id: job.job_id,
      title: job.title,
      company: job.company,
      location: job.location || "Remote",
      salary: job.salary || null,
      url: job.url || null,
      description: description.slice(0, 5000),
      score,
      verdict: score >= 85 ? "STRONG FIT" : score >= 70 ? "GOOD FIT" : score >= 50 ? "WEAK FIT" : "NO FIT",
      match_reasons: analysis.match_reasons || [],
      gaps: analysis.gaps || [],
      key_requirements: analysis.key_requirements || [],
      salary_estimate: analysis.salary_estimate || null,
      quick_pitch: analysis.quick_pitch || null,
      apply_recommendation: analysis.apply_recommendation,
      status,
      search_query: job.search_query,
      found_at: new Date().toISOString(),
      is_federal: federal,
      is_defense_prime: defensePrime,
      clearance_mentioned: clearanceMentioned,
      ats_type: atsType,
      queued_at: queuedAt,
    });

    results.jobs_new++;
    await new Promise(r => setTimeout(r, 300));
  }

  // Log the scan
  await supabaseAdmin.from("scan_log").insert({
    jobs_found: results.jobs_found,
    jobs_new: results.jobs_new,
    jobs_queued: results.jobs_queued,
    queries_run: results.queries_run
  });

  return NextResponse.json({
    success: true,
    ...results,
    debug: `Found ${allJobs.length} raw, ${unique.length} unique, ${newJobs.length} new, ${results.jobs_queued} queued`
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
