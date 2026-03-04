import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { CANDIDATE, SCORING_SYSTEM_PROMPT, DEFENSE_PRIMES, CLEARANCE_KEYWORDS } from "@/lib/profile";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Search Indeed by scraping public search results
async function searchIndeed(query: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      l: "remote",
      remotejob: "032b3046-06a3-4876-8dfd-474eb5e7ed11",
      sort: "date",
      limit: "10",
    });
    const url = `https://www.indeed.com/jobs?${params}`;
    console.log(`[scan] Fetching: ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.error(`[scan] Indeed returned ${res.status} for "${query}"`);
      return [];
    }

    const html = await res.text();
    console.log(`[scan] Got ${html.length} chars of HTML for "${query}"`);

    // Extract job data from Indeed's embedded JSON (window.mosaic.providerData)
    const scriptMatch = html.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (scriptMatch) {
      const data = JSON.parse(scriptMatch[1]);
      const results = data?.metaData?.mosaicProviderJobCardsModel?.results || [];
      return results.map((r: any) => ({
        job_id: r.jobkey,
        title: r.title || r.displayTitle,
        company: r.company,
        location: r.formattedLocation || r.jobLocationCity || "Remote",
        salary: r.extractedSalary ? `$${r.extractedSalary.min?.toLocaleString() || ""}–$${r.extractedSalary.max?.toLocaleString() || ""}` : r.salarySnippet?.text || null,
        url: `https://www.indeed.com/viewjob?jk=${r.jobkey}`,
        description: r.snippet || "",
      }));
    }

    // Fallback: use Claude to extract jobs from HTML
    console.log(`[scan] No embedded JSON found, using Claude to parse HTML for "${query}"`);
    const truncatedHtml = html.slice(0, 15000);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `Extract job listings from this Indeed HTML. Return a JSON array. Each object: job_id, title, company, location, salary (or null), url, description (snippet). Return ONLY the JSON array.\n\nHTML:\n${truncatedHtml}`
      }]
    });

    const text = (response.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      return JSON.parse(arrMatch[0]);
    }

    console.log(`[scan] Could not extract jobs for "${query}"`);
    return [];
  } catch (err: any) {
    console.error(`[scan] Indeed search failed for "${query}":`, err?.message || err);
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

  const results = { jobs_found: 0, jobs_new: 0, jobs_queued: 0, queries_run: [] as string[] };
  const allJobs: any[] = [];

  // Run all search queries
  for (const query of CANDIDATE.search_queries) {
    results.queries_run.push(query);
    const jobs = await searchIndeed(query);
    allJobs.push(...jobs.map(j => ({ ...j, search_query: query })));
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
    // 75-84 non-federal → "new" (manual approval)
    // 60-74 → "new" (save, don't auto-apply)

    await supabaseAdmin.from("jobs").upsert({
      id: job.job_id || `${job.title}-${job.company}-${Date.now()}`.replace(/\s+/g, "-").toLowerCase(),
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
