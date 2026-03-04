import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const [allJobs, scanLog] = await Promise.all([
    supabaseAdmin.from("jobs").select("status, score, verdict, found_at, applied_at, is_federal"),
    supabaseAdmin.from("scan_log").select("*").order("ran_at", { ascending: false }).limit(1)
  ]);

  const jobs = allJobs.data || [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();

  const stats = {
    // Legacy stats (backward compat)
    total: jobs.length,
    new: jobs.filter(j => j.status === "new").length,
    applied: jobs.filter(j => j.status === "applied").length,
    skipped: jobs.filter(j => j.status === "skipped" || j.status === "withdrawn").length,
    interviewing: jobs.filter(j => j.status === "interviewing").length,
    strong_fits: jobs.filter(j => j.verdict === "STRONG FIT").length,
    avg_score: jobs.length ? Math.round(jobs.reduce((s, j) => s + (j.score || 0), 0) / jobs.length) : 0,
    last_scan: scanLog.data?.[0]?.ran_at || null,
    action_needed: jobs.filter(j => j.status === "new" && j.score >= 80).length,

    // New metrics
    applied_today: jobs.filter(j => j.status === "applied" && j.applied_at && j.applied_at >= todayStart).length,
    applied_this_week: jobs.filter(j => j.status === "applied" && j.applied_at && j.applied_at >= weekStart).length,
    total_applied: jobs.filter(j => j.status === "applied").length,
    active_interviews: jobs.filter(j => ["screening", "interviewing", "offer"].includes(j.status)).length,
    manual_required: jobs.filter(j => j.status === "manual_required").length,
    strong_fits_pending: jobs.filter(j => j.verdict === "STRONG FIT" && j.status === "new").length,
    queued_to_apply: jobs.filter(j => j.status === "queued_to_apply").length,
    failed: jobs.filter(j => j.status === "failed").length,
  };

  return NextResponse.json(stats);
}
