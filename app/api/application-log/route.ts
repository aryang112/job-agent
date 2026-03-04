import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/application-log — fetch application log entries, optional ?job_id=X
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job_id");
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabaseAdmin
    .from("application_log")
    .select("*, jobs(title, company)")
    .order("attempted_at", { ascending: false })
    .limit(limit);

  if (jobId) {
    query = query.eq("job_id", jobId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
