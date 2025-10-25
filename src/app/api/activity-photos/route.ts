import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "../../../core/config/env";

const AMAP_ADVANCED_ENDPOINT = "https://restapi.amap.com/v5/place/advanced";
const WIKIPEDIA_ENDPOINTS = [
  "https://zh.wikipedia.org/w/api.php",
  "https://en.wikipedia.org/w/api.php"
];

async function fetchAmapPhotos(query: string, region?: string): Promise<string[]> {
  const env = loadEnv();
  const apiKey = env.AMAP_REST_KEY;

  if (!apiKey) {
    return [];
  }

  const params = new URLSearchParams({
    key: apiKey,
    keywords: query,
    page_size: "5",
    page_num: "1",
    show_fields: "photos"
  });

  if (region) {
    params.set("region", region);
    params.set("city", region);
  }

  try {
    const response = await fetch(`${AMAP_ADVANCED_ENDPOINT}?${params.toString()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    const pois = Array.isArray((data as { pois?: unknown }).pois) ? (data as { pois: unknown[] }).pois : [];
    const photos: string[] = [];

    for (const poi of pois) {
      const rawPhotos = Array.isArray((poi as { photos?: unknown }).photos)
        ? ((poi as { photos: unknown[] }).photos)
        : [];

      for (const photo of rawPhotos) {
        const candidate =
          (photo as { url?: unknown }).url ??
          (photo as { photo_url?: unknown }).photo_url ??
          (photo as { photo?: unknown }).photo;

        if (typeof candidate === "string" && candidate.startsWith("http")) {
          photos.push(candidate);
        }

        if (photos.length >= 6) {
          break;
        }
      }

      if (photos.length >= 6) {
        break;
      }
    }

    return photos.slice(0, 6);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[activity-photos] amap lookup failed", error);
    }

    return [];
  }
}

async function fetchPhotoCandidates(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "pageimages",
    piprop: "original",
    pilicense: "any",
    generator: "prefixsearch",
    gpssearch: query,
    gpslimit: "6",
    pithumbsize: "600"
  });

  for (const endpoint of WIKIPEDIA_ENDPOINTS) {
    try {
      const url = `${endpoint}?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "ai-travel-planner/1.0 (https://github.com/Chiralux/ai-travel-planner)"
        },
        cache: "no-store"
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const pages = data?.query?.pages;

      if (!pages) {
        continue;
      }

      const urls: string[] = [];

      for (const pageId of Object.keys(pages)) {
        const page = pages[pageId];
        const source: unknown = page?.original?.source;

        if (typeof source === "string" && source.startsWith("https://")) {
          urls.push(source);
        }

        if (urls.length >= 4) {
          break;
        }
      }

      if (urls.length > 0) {
        return urls;
      }
    } catch {
      // Try next endpoint
    }
  }

  return [];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q");
  const region = searchParams.get("region") ?? undefined;

  if (!rawQuery) {
    return NextResponse.json({ ok: true, photos: [] });
  }

  const query = rawQuery.trim().slice(0, 120);

  if (!query) {
    return NextResponse.json({ ok: true, photos: [] });
  }

  try {
    const amapPhotos = await fetchAmapPhotos(query, region);

    if (amapPhotos.length > 0) {
      return NextResponse.json({ ok: true, photos: amapPhotos.slice(0, 4) });
    }

    const photos = await fetchPhotoCandidates(query);
    return NextResponse.json({ ok: true, photos });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[activity-photos] lookup failed", error);
    }

    return NextResponse.json({ ok: true, photos: [] });
  }
}
