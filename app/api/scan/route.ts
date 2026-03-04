import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { CANDIDATE, SCORING_SYSTEM_PROMPT } from "@/lib/profile";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Search Indeed via Anthropic MCP proxy
async function searchIndeed(query: string): Promise<any[]> {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      mcp_servers: [
        { type: "url", url: "https://mcp.indeed.com/claude/mcp", name: "indeed-mcp" } as any
      ],
      messages: [{
        role: "user",
        content: `Search Indeed for: "${query}". Return top 6 remote jobs as a JSON array. Each object must include: job_id, title, company, location, salary (or null), url, description (full text from the posting). Return ONLY the JSON array, no other text.`
      }]
    } as any);

    const text = (response.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Also check mcp_tool_result blocks
    const mcpResults = (response.content || [])
      .filter((b: any) => b.type === "mcp_tool_result")
      .flatMap((b: any) => b.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    const combined = mcpResults || text;

    // Try to extract JSON array
    const match = combined.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  } catch (err) {
    console.error(`Indeed search failed for "${query}":`, err);
    return [];
  }
}

// Score a job against Aryan's profile using Claude
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

export async function GET(req: NextRequest) {
  // Protect cron endpoint
  const authHeader = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const isManual = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = { jobs_found: 0, jobs_new: 0, queries_run: [] as string[] };
  const allJobs: any[] = [];

  // Run all search queries
  for (const query of CANDIDATE.search_queries) {
    results.queries_run.push(query);
    const jobs = await searchIndeed(query);
    allJobs.push(...jobs.map(j => ({ ...j, search_query: query })));
    // Small delay to be respectful
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

    // Only save if score >= 60 (weak fit or better)
    if (analysis.score < 60) continue;

    await supabaseAdmin.from("jobs").upsert({
      id: job.job_id || `${job.title}-${job.company}-${Date.now()}`.replace(/\s+/g, "-").toLowerCase(),
      title: job.title,
      company: job.company,
      location: job.location || "Remote",
      salary: job.salary || null,
      url: job.url || null,
      description: (job.description || "").slice(0, 5000),
      score: analysis.score,
      verdict: analysis.verdict,
      match_reasons: analysis.match_reasons || [],
      gaps: analysis.gaps || [],
      key_requirements: analysis.key_requirements || [],
      salary_estimate: analysis.salary_estimate || null,
      quick_pitch: analysis.quick_pitch || null,
      apply_recommendation: analysis.apply_recommendation,
      status: "new",
      search_query: job.search_query,
      found_at: new Date().toISOString()
    });

    results.jobs_new++;
    await new Promise(r => setTimeout(r, 300));
  }

  // Log the scan
  await supabaseAdmin.from("scan_log").insert({
    jobs_found: results.jobs_found,
    jobs_new: results.jobs_new,
    queries_run: results.queries_run
  });

  return NextResponse.json({ success: true, ...results });
}

// Also allow POST for manual trigger from dashboard
export async function POST(req: NextRequest) {
  return GET(req);
}
