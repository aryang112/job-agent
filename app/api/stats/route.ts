import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const [allJobs, scanLog] = await Promise.all([
    supabaseAdmin.from("jobs").select("status, score, verdict, found_at, applied_at"),
    supabaseAdmin.from("scan_log").select("*").order("ran_at", { ascending: false }).limit(1)
  ]);

  const jobs = allJobs.data || [];

  const stats = {
    total: jobs.length,
    new: jobs.filter(j => j.status === "new").length,
    applied: jobs.filter(j => j.status === "applied").length,
    skipped: jobs.filter(j => j.status === "skipped").length,
    interviewing: jobs.filter(j => j.status === "interviewing").length,
    strong_fits: jobs.filter(j => j.verdict === "STRONG FIT").length,
    avg_score: jobs.length ? Math.round(jobs.reduce((s, j) => s + (j.score || 0), 0) / jobs.length) : 0,
    last_scan: scanLog.data?.[0]?.ran_at || null,
    action_needed: jobs.filter(j => j.status === "new" && j.score >= 80).length
  };

  return NextResponse.json(stats);
}
