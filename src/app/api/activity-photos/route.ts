import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "../../../core/config/env";

const AMAP_TEXT_ENDPOINT = "https://restapi.amap.com/v5/place/text";
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_LIMIT = 2;

type AMapPhoto = {
  url?: string;
};

type AMapPoi = {
  photos?: AMapPhoto[];
};

type AMapPoiResponse = {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: AMapPoi[];
};

function sanitizeUrl(value?: string | null): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (!url.protocol.startsWith("http")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function clampLimit(limit: number | null): number {
  if (limit == null || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 6);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const destination = searchParams.get("destination")?.trim();
  const address = searchParams.get("address")?.trim();
  const rawLimit = searchParams.get("limit");
  const limit = clampLimit(rawLimit ? Number(rawLimit) : null);

  if (!title) {
    return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
  }

  const env = loadEnv();
  const apiKey = env.AMAP_REST_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "AMAP_REST_KEY not configured" }, { status: 500 });
  }

  const keywords = [title, address, destination]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .slice(0, 120);

  const url = new URL(AMAP_TEXT_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("keywords", keywords || title);
  url.searchParams.set("page_num", "1");
  url.searchParams.set("page_size", String(DEFAULT_PAGE_SIZE));
  url.searchParams.set("output", "JSON");
  url.searchParams.set("show_fields", "photos");

  if (destination) {
    url.searchParams.set("region", destination);
    url.searchParams.set("city", destination);
  }

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to request AMap new POI search",
          status: upstream.status,
          details: text
        },
        { status: 502 }
      );
    }

    const json = (await upstream.json()) as AMapPoiResponse;

    if (json.status !== "1" || !Array.isArray(json.pois)) {
      return NextResponse.json(
        {
          ok: false,
          error: json.info || "AMap new POI search returned no results",
          infocode: json.infocode
        },
        { status: 502 }
      );
    }

    const photos: string[] = [];
    const seen = new Set<string>();

    outer: for (const poi of json.pois) {
      if (!Array.isArray(poi.photos) || poi.photos.length === 0) {
        continue;
      }

      for (const photo of poi.photos) {
        const candidate = sanitizeUrl(photo.url);

        if (!candidate || seen.has(candidate)) {
          continue;
        }

        seen.add(candidate);
        photos.push(candidate);

        if (photos.length >= limit) {
          break outer;
        }
      }
    }

    return NextResponse.json({ ok: true, data: { photos } }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Unexpected error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
