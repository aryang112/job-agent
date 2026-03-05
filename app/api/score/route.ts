import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { SCORING_SYSTEM_PROMPT, DEFENSE_PRIMES, CLEARANCE_KEYWORDS } from "@/lib/profile";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/score — score a single unscored job (called repeatedly from dashboard)
// GET /api/score — score the next unscored job automatically
export async function GET(req: NextRequest) {
  const isLoggedIn = req.cookies.get("auth_token")?.value === process.env.AUTH_SECRET;
  if (!isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find next unscored job
  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .is("score", null)
    .order("found_at", { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ done: true, message: "All jobs scored" });
  }

  const job = jobs[0];
  return scoreAndUpdate(job);
}

export async function POST(req: NextRequest) {
  const isLoggedIn = req.cookies.get("auth_token")?.value === process.env.AUTH_SECRET;
  if (!isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  if (id) {
    // Score a specific job
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return scoreAndUpdate(job);
  }

  // No id — score next unscored
  return GET(req);
}

async function scoreAndUpdate(job: any) {
  const jobText = `
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "Not specified"}
Salary: ${job.salary || "Not listed"}
Description: ${(job.description || "").slice(0, 3000)}
  `.trim();

  try {
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

    const analysis = JSON.parse(text);
    let score = analysis.score || 0;

    // Server-side defense/federal detection + boosts
    const company = job.company || "";
    const description = job.description || "";
    const defensePrime = DEFENSE_PRIMES.some(p => company.toLowerCase().includes(p.toLowerCase()));
    const federal = defensePrime || analysis.is_federal === true;
    const clearanceMentioned = CLEARANCE_KEYWORDS.some(kw => description.toLowerCase().includes(kw)) || analysis.clearance_mentioned === true;

    if (defensePrime) {
      score = Math.max(score + 20, 80);
    } else if (federal) {
      score = Math.max(score + 15, 75);
    }
    if (clearanceMentioned) {
      score = Math.min(score + 10, 100);
    }

    // Easy Apply boost — these are automatable, prioritize them
    const isEasyApply = (job.ats_type === "easy_apply");
    if (isEasyApply && score >= 50) {
      score = Math.min(score + 10, 100);
    }

    // Auto-status assignment
    let status = score < 60 ? "rejected" : "new";
    let queuedAt: string | null = null;

    // Blocked ATS sites go straight to manual
    if (job.ats_type === "blocked") {
      status = score >= 60 ? "manual_required" : "rejected";
    } else if (score >= 85) {
      status = "queued_to_apply";
      queuedAt = new Date().toISOString();
    } else if (score >= 75 && federal) {
      status = "queued_to_apply";
      queuedAt = new Date().toISOString();
    } else if (score >= 70 && isEasyApply) {
      // Lower threshold for Easy Apply since bot can handle them
      status = "queued_to_apply";
      queuedAt = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from("jobs")
      .update({
        score,
        verdict: score >= 85 ? "STRONG FIT" : score >= 70 ? "GOOD FIT" : score >= 50 ? "WEAK FIT" : "NO FIT",
        match_reasons: analysis.match_reasons || [],
        gaps: analysis.gaps || [],
        key_requirements: analysis.key_requirements || [],
        salary_estimate: analysis.salary_estimate || null,
        quick_pitch: analysis.quick_pitch || null,
        apply_recommendation: analysis.apply_recommendation,
        status,
        is_federal: federal,
        is_defense_prime: defensePrime,
        clearance_mentioned: clearanceMentioned,
        queued_at: queuedAt,
      })
      .eq("id", job.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Check how many unscored remain
    const { count } = await supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .is("score", null);

    return NextResponse.json({
      scored: true,
      job: { id: job.id, title: job.title, company: job.company, score, status },
      remaining: count || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Scoring failed: ${err?.message}` }, { status: 500 });
  }
}
