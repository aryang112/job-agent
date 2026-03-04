import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/jobs — fetch jobs with optional status filter
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // new | applied | skipped | all
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabaseAdmin
    .from("jobs")
    .select("*")
    .order("score", { ascending: false })
    .limit(limit);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH /api/jobs — update job status (applied, skipped, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, notes } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  const update: any = { status };
  if (notes !== undefined) update.notes = notes;
  if (status === "applied") update.applied_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
