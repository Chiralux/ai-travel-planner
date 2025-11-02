import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadEnv } from "../../../../core/config/env";
import { isCoordinateInChina } from "../../../../lib/maps/provider";
import { fetchGoogleRoute } from "../../../../adapters/maps/googleDirections";

const requestSchema = z.object({
  origin: z.object({
    lat: z.number(),
    lng: z.number()
  }),
  destination: z.object({
    lat: z.number(),
    lng: z.number()
  }),
  mode: z.enum(["driving", "walking", "cycling", "transit"]).default("driving"),
  strategy: z
    .union([
      z.literal("0"),
      z.literal("1"),
      z.literal("2"),
      z.literal("3"),
      z.literal("4"),
      z.literal("5"),
      z.literal("6"),
      z.literal("7"),
      z.literal("8"),
      z.literal("9"),
      z.literal("10"),
      z.literal("11")
    ])
    .optional()
});

const GAODE_ENDPOINTS = {
  driving: "https://restapi.amap.com/v3/direction/driving",
  walking: "https://restapi.amap.com/v3/direction/walking",
  cycling: "https://restapi.amap.com/v4/direction/bicycling",
  transit: "https://restapi.amap.com/v3/direction/transit/integrated"
} as const;

type PolylineCarrier = { polyline?: string };

type GaodeDrivingWalkingResponse = {
  status?: string;
  info?: string;
  route?: {
    paths?: Array<{
      distance?: string;
      duration?: string;
      steps?: PolylineCarrier[];
    }>;
  };
};

type GaodeCyclingResponse = {
  errcode?: number;
  errmsg?: string;
  data?: {
    paths?: Array<{
      distance?: number;
      duration?: number;
      steps?: PolylineCarrier[];
    }>;
  };
};

type GaodeTransitResponse = {
  status?: string;
  info?: string;
  route?: {
    transits?: Array<{
      distance?: string;
      duration?: string;
      segments?: Array<{
        walking?: {
          steps?: PolylineCarrier[];
        };
        bus?: {
          buslines?: PolylineCarrier[];
        };
        railway?: {
          alins?: PolylineCarrier[];
        };
        taxi?: {
          path?: string;
        };
      }>;
    }>;
  };
};

function pushPoint(points: Array<{ lat: number; lng: number }>, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }

  const last = points[points.length - 1];
  const isDuplicate =
    last && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lng - lng) < 1e-6;

  if (!isDuplicate) {
    points.push({ lat, lng });
  }
}

function appendPolyline(points: Array<{ lat: number; lng: number }>, polyline?: string) {
  if (!polyline) {
    return;
  }

  const segments = polyline.split(";");

  for (const segment of segments) {
    const [lngText, latText] = segment.split(",");
    const lng = Number.parseFloat(lngText);
    const lat = Number.parseFloat(latText);
    pushPoint(points, lat, lng);
  }
}

function appendStepCollection(points: Array<{ lat: number; lng: number }>, steps?: PolylineCarrier[]) {
  if (!Array.isArray(steps)) {
    return;
  }

  for (const step of steps) {
    appendPolyline(points, step?.polyline);
  }
}

function parseNumeric(value?: string | number | null): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export async function POST(request: NextRequest) {
  const env = loadEnv();

  let payload: z.infer<typeof requestSchema>;

  try {
    const json = await request.json();
    payload = requestSchema.parse(json);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request payload" }, { status: 400 });
  }

  const originCoordinate = payload.origin;
  const destinationCoordinate = payload.destination;

  const shouldUseGoogle =
    !isCoordinateInChina(originCoordinate) || !isCoordinateInChina(destinationCoordinate);

  if (shouldUseGoogle) {
    const googleKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!googleKey) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_MAPS_API_KEY not configured" },
        { status: 500 }
      );
    }

    const route = await fetchGoogleRoute({
      origin: originCoordinate,
      destination: destinationCoordinate,
      mode: payload.mode,
      apiKey: googleKey
    });

    if (!route) {
      return NextResponse.json(
        { ok: false, error: "Google Routes API returned no usable route" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        points: route.points,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        mode: payload.mode
      }
    });
  }

  if (!env.AMAP_REST_KEY) {
    return NextResponse.json({ ok: false, error: "AMAP_REST_KEY not configured" }, { status: 500 });
  }

  const origin = `${originCoordinate.lng},${originCoordinate.lat}`;
  const destination = `${destinationCoordinate.lng},${destinationCoordinate.lat}`;

  switch (payload.mode) {
    case "cycling":
      return handleCycling(origin, destination, env.AMAP_REST_KEY);
    case "transit":
      return handleTransit(origin, destination, env.AMAP_REST_KEY);
    case "walking":
      return handleDrivingOrWalking("walking", origin, destination, env.AMAP_REST_KEY);
    case "driving":
    default:
      return handleDrivingOrWalking("driving", origin, destination, env.AMAP_REST_KEY, payload.strategy);
  }
}

async function handleDrivingOrWalking(
  mode: "driving" | "walking",
  origin: string,
  destination: string,
  apiKey: string,
  strategy?: string
) {
  const url = new URL(GAODE_ENDPOINTS[mode]);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("extensions", "base");
  if (mode === "driving") {
    url.searchParams.set("strategy", strategy ?? "0");
  }

  let upstreamJson: GaodeDrivingWalkingResponse;
  let upstreamStatus = 200;

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });
    upstreamStatus = upstream.status;
    upstreamJson = (await upstream.json()) as GaodeDrivingWalkingResponse;
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to reach Gaode API" }, { status: 502 });
  }

  if (!upstreamJson || upstreamJson.status !== "1" || !upstreamJson.route?.paths?.length) {
    return NextResponse.json(
      {
        ok: false,
        error: upstreamJson?.info ?? "Gaode API returned no route",
        details: upstreamJson,
        status: upstreamStatus
      },
      { status: 502 }
    );
  }

  const path = upstreamJson.route.paths[0];
  const points: Array<{ lat: number; lng: number }> = [];
  appendStepCollection(points, path.steps);

  if (points.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to parse route polyline",
        details: upstreamJson
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      points,
      distanceMeters: parseNumeric(path.distance),
      durationSeconds: parseNumeric(path.duration),
      mode
    }
  });
}

async function handleCycling(origin: string, destination: string, apiKey: string) {
  const url = new URL(GAODE_ENDPOINTS.cycling);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);

  let upstreamJson: GaodeCyclingResponse;
  let upstreamStatus = 200;

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });
    upstreamStatus = upstream.status;
    upstreamJson = (await upstream.json()) as GaodeCyclingResponse;
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to reach Gaode API" }, { status: 502 });
  }

  const path = upstreamJson?.data?.paths?.[0];

  if (!path || upstreamJson?.errcode) {
    return NextResponse.json(
      {
        ok: false,
        error: upstreamJson?.errmsg ?? "Gaode cycling API returned no route",
        details: upstreamJson,
        status: upstreamStatus
      },
      { status: 502 }
    );
  }

  const points: Array<{ lat: number; lng: number }> = [];
  appendStepCollection(points, path.steps);

  if (points.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to parse cycling route",
        details: upstreamJson
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      points,
      distanceMeters: parseNumeric(path.distance),
      durationSeconds: parseNumeric(path.duration),
      mode: "cycling"
    }
  });
}

async function handleTransit(origin: string, destination: string, apiKey: string) {
  const url = new URL(GAODE_ENDPOINTS.transit);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("city", "");
  url.searchParams.set("extensions", "base");
  url.searchParams.set("strategy", "0");

  let upstreamJson: GaodeTransitResponse;
  let upstreamStatus = 200;

  try {
    const upstream = await fetch(url.toString(), { cache: "no-store" });
    upstreamStatus = upstream.status;
    upstreamJson = (await upstream.json()) as GaodeTransitResponse;
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to reach Gaode API" }, { status: 502 });
  }

  if (!upstreamJson || upstreamJson.status !== "1" || !upstreamJson.route?.transits?.length) {
    return NextResponse.json(
      {
        ok: false,
        error: upstreamJson?.info ?? "Gaode transit API returned no route",
        details: upstreamJson,
        status: upstreamStatus
      },
      { status: 502 }
    );
  }

  const transit = upstreamJson.route.transits[0];
  const points: Array<{ lat: number; lng: number }> = [];

  if (transit.segments) {
    for (const segment of transit.segments) {
      appendStepCollection(points, segment.walking?.steps);
      appendStepCollection(points, segment.bus?.buslines);
      appendStepCollection(points, segment.railway?.alins);
      if (segment.taxi?.path) {
        appendPolyline(points, segment.taxi.path);
      }
    }
  }

  if (points.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to parse transit route",
        details: upstreamJson
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      points,
      distanceMeters: parseNumeric(transit.distance),
      durationSeconds: parseNumeric(transit.duration),
      mode: "transit"
    }
  });
}
