import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/notes — list all notes, optional ?category=X filter
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  let query = supabaseAdmin
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/notes — create a new note
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { category, title, story, keywords } = body;

  if (!category || !title || !story) {
    return NextResponse.json({ error: "category, title, and story required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("notes")
    .insert({ category, title, story, keywords: keywords || [] })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
