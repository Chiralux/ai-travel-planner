import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "../../../../core/config/env";

const AMAP_REVERSE_ENDPOINT = "https://restapi.amap.com/v3/geocode/regeo";

function isNumeric(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Number(value));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");

  if (!isNumeric(latRaw) || !isNumeric(lngRaw)) {
    return NextResponse.json({ ok: false, error: "lat and lng query parameters are required" }, { status: 400 });
  }

  const env = loadEnv();
  const apiKey = env.AMAP_REST_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "AMAP_REST_KEY is not configured" }, { status: 500 });
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: false, error: "lat and lng must be valid numbers" }, { status: 400 });
  }

  const url = new URL(AMAP_REVERSE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location", `${lng},${lat}`);
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "JSON");

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { ok: false, error: "Reverse geocode upstream failed", status: response.status, details: text },
        { status: 502 }
      );
    }

    const payload = await response.json();

    if (payload.status !== "1" || !payload.regeocode) {
      return NextResponse.json(
        { ok: false, error: payload.info ?? "Unknown reverse geocode error" },
        { status: 502 }
      );
    }

    const addressComponent = payload.regeocode.addressComponent ?? {};
    const province: string | undefined = addressComponent.province;
    const cityRaw: string | string[] | undefined = addressComponent.city;
    const district: string | undefined = addressComponent.district;

    const city = Array.isArray(cityRaw) ? cityRaw[0] : cityRaw;
    const labelParts = [city || province, district].filter((part): part is string => Boolean(part));
    const label = labelParts.length > 0 ? labelParts.join("") : payload.regeocode.formatted_address ?? "当前位置";

    return NextResponse.json({
      ok: true,
      data: {
        label,
        province: province ?? null,
        city: city ?? null,
        district: district ?? null,
        formattedAddress: payload.regeocode.formatted_address ?? null,
        location: { lat, lng }
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Reverse geocode request failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
