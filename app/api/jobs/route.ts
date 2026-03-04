import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/jobs — fetch jobs with filters, search, sort
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const federal = searchParams.get("federal");
  const search = searchParams.get("search");
  const scoreMin = searchParams.get("score_min");
  const scoreMax = searchParams.get("score_max");
  const atsType = searchParams.get("ats_type");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const sort = searchParams.get("sort") || "score";
  const order = searchParams.get("order") || "desc";
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabaseAdmin
    .from("jobs")
    .select("*")
    .limit(limit);

  // Status filters
  if (status === "to_apply") {
    query = query.in("status", ["new", "queued_to_apply"]).gte("score", 75);
  } else if (status === "manual_required") {
    query = query.eq("status", "manual_required");
  } else if (status && status !== "all") {
    query = query.eq("status", status);
  }

  // Federal filter
  if (federal === "true") {
    query = query.eq("is_federal", true);
  }

  // Free text search on title + company
  if (search) {
    query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%`);
  }

  // Score range
  if (scoreMin) query = query.gte("score", parseInt(scoreMin));
  if (scoreMax) query = query.lte("score", parseInt(scoreMax));

  // ATS type
  if (atsType) query = query.eq("ats_type", atsType);

  // Date range
  if (dateFrom) query = query.gte("found_at", dateFrom);
  if (dateTo) query = query.lte("found_at", dateTo);

  // Sorting
  const ascending = order === "asc";
  if (sort === "date") {
    query = query.order("found_at", { ascending });
  } else if (sort === "company") {
    query = query.order("company", { ascending });
  } else {
    query = query.order("score", { ascending });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH /api/jobs — update job status and fields
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, notes, user_notes } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const VALID_STATUSES = [
    "new", "queued_to_apply", "applied", "failed", "manual_required",
    "no_response", "screening", "interviewing", "offer", "rejected", "withdrawn"
  ];

  const update: any = {};

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }
    update.status = status;
    if (status === "applied") update.applied_at = new Date().toISOString();
    if (status === "queued_to_apply") update.queued_at = new Date().toISOString();
  }

  if (notes !== undefined) update.notes = notes;
  if (user_notes !== undefined) update.user_notes = user_notes;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
