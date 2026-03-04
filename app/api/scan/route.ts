import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { CANDIDATE, DEFENSE_PRIMES, CLEARANCE_KEYWORDS } from "@/lib/profile";

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

// GET/POST /api/scan — fetch jobs from JSearch and save to Supabase (no scoring)
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

  const results = { jobs_found: 0, jobs_new: 0, queries_run: [] as string[] };
  const allJobs: any[] = [];

  // Run all search queries
  for (const query of CANDIDATE.search_queries) {
    results.queries_run.push(query);
    const jobs = await searchJobs(query);
    allJobs.push(...jobs);
    await new Promise(r => setTimeout(r, 500));
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

  // Insert new jobs WITHOUT scoring (stays under 10s Vercel timeout)
  for (const job of newJobs) {
    const company = job.company || "";
    const description = job.description || "";
    const defensePrime = isDefensePrime(company);
    const federal = defensePrime || hasClearanceKeywords(description);
    const clearanceMentioned = hasClearanceKeywords(description);
    const atsType = detectAtsType(job.url || "");

    await supabaseAdmin.from("jobs").upsert({
      id: job.job_id,
      title: job.title,
      company: job.company,
      location: job.location || "Remote",
      salary: job.salary || null,
      url: job.url || null,
      description: description.slice(0, 5000),
      score: null,  // Unscored — will be scored by /api/score
      verdict: null,
      match_reasons: [],
      gaps: [],
      key_requirements: [],
      salary_estimate: null,
      quick_pitch: null,
      apply_recommendation: null,
      status: "new",
      search_query: job.search_query,
      found_at: new Date().toISOString(),
      is_federal: federal,
      is_defense_prime: defensePrime,
      clearance_mentioned: clearanceMentioned,
      ats_type: atsType,
    });

    results.jobs_new++;
  }

  // Log the scan
  await supabaseAdmin.from("scan_log").insert({
    jobs_found: results.jobs_found,
    jobs_new: results.jobs_new,
    jobs_queued: 0,
    queries_run: results.queries_run
  });

  return NextResponse.json({
    success: true,
    ...results,
    debug: `Found ${allJobs.length} raw, ${unique.length} unique, ${newJobs.length} new (unscored)`
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
