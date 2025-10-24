import { NextRequest, NextResponse } from "next/server";
import { TravelInputParserService } from "../../../services/TravelInputParserService";

const parser = new TravelInputParserService();

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ ok: false, error: "Body must be an object" }, { status: 400 });
  }

  const { text, knownPreferences } = payload as {
    text?: unknown;
    knownPreferences?: unknown;
  };

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  const prefs = Array.isArray(knownPreferences)
    ? knownPreferences.filter((item): item is string => typeof item === "string")
    : undefined;

  try {
    const result = await parser.parse(text, { knownPreferences: prefs });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
