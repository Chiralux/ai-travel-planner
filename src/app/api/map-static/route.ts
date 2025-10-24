import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "../../../core/config/env";

const DEFAULT_LOCATION = "121.473701,31.230391"; // Shanghai downtown
const DEFAULT_ZOOM = "11";
const DEFAULT_SIZE = "720*480";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const env = loadEnv();
  const apiKey = env.AMAP_REST_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "AMAP_REST_KEY not configured" }, { status: 500 });
  }

  const location = searchParams.get("location") ?? DEFAULT_LOCATION;
  const zoom = searchParams.get("zoom") ?? DEFAULT_ZOOM;
  const size = searchParams.get("size") ?? DEFAULT_SIZE;
  const scale = searchParams.get("scale") ?? "2";
  const markers = searchParams.get("markers");

  const url = new URL("https://restapi.amap.com/v3/staticmap");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location", location);
  url.searchParams.set("zoom", zoom);
  url.searchParams.set("size", size);
  url.searchParams.set("scale", scale);

  if (markers) {
    url.searchParams.set("markers", markers);
  }

  const upstream = await fetch(url.toString(), { cache: "no-store" });

  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { ok: false, error: "Static map request failed", status: upstream.status, details: text },
      { status: 502 }
    );
  }

  const arrayBuffer = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "image/png";

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  });
}
