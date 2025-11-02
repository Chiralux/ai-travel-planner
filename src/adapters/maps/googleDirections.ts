import type { Dispatcher } from "undici";
import { getGoogleMapsDispatcher } from "./googleDispatcher";
import { decodePolyline, type PolylinePoint } from "../../lib/maps/polyline";

export type GoogleDirectionsMode = "driving" | "walking" | "cycling" | "transit";

export type GoogleRouteResult = {
  points: PolylinePoint[];
  distanceMeters: number;
  durationSeconds: number;
};

const COMPUTE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";

function toTravelMode(mode: GoogleDirectionsMode): string {
  switch (mode) {
    case "walking":
      return "WALK";
    case "cycling":
      return "BICYCLE";
    case "transit":
      return "TRANSIT";
    case "driving":
    default:
      return "DRIVE";
  }
}

function buildRequestBody(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: GoogleDirectionsMode;
}): unknown {
  const travelMode = toTravelMode(params.mode);
  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: {
          latitude: params.origin.lat,
          longitude: params.origin.lng
        }
      }
    },
    destination: {
      location: {
        latLng: {
          latitude: params.destination.lat,
          longitude: params.destination.lng
        }
      }
    },
    travelMode,
    computeAlternativeRoutes: false
  };

  if (travelMode === "DRIVE") {
    body.routingPreference = "TRAFFIC_AWARE";
  }

  if (travelMode === "TRANSIT") {
    body.transitPreferences = { routingPreference: "TRANSIT_ROUTING_PREFERENCE_LESS_TRANSFERS" };
    body.departureTime = new Date().toISOString();
  }

  return body;
}

function parseDurationSeconds(duration?: string | null): number {
  if (!duration) {
    return 0;
  }

  const secondsMatch = duration.match(/^([0-9]+(?:\.[0-9]+)?)s$/);

  if (secondsMatch) {
    return Number.parseFloat(secondsMatch[1]);
  }

  // Fallback for ISO 8601 durations (e.g., PT1H2M3S)
  const isoMatch = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);

  if (!isoMatch) {
    return 0;
  }

  const hours = isoMatch[1] ? Number.parseInt(isoMatch[1], 10) : 0;
  const minutes = isoMatch[2] ? Number.parseInt(isoMatch[2], 10) : 0;
  const seconds = isoMatch[3] ? Number.parseFloat(isoMatch[3]) : 0;

  return hours * 3600 + minutes * 60 + seconds;
}

export async function fetchGoogleRoute(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: GoogleDirectionsMode;
  apiKey: string;
}): Promise<GoogleRouteResult | null> {
  const dispatcher = getGoogleMapsDispatcher();
  const fetchInit: RequestInit & { dispatcher?: Dispatcher } = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": params.apiKey,
      "X-Goog-FieldMask": FIELD_MASK
    },
    body: JSON.stringify(buildRequestBody(params))
  };

  if (dispatcher) {
    fetchInit.dispatcher = dispatcher;
  }

  let response: Response;

  try {
    response = await fetch(COMPUTE_ROUTES_ENDPOINT, fetchInit);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[GoogleRoutes] Request failed", {
        error,
        origin: params.origin,
        destination: params.destination,
        mode: params.mode
      });
    }

    return null;
  }

  if (!response.ok) {
    if (process.env.NODE_ENV !== "production") {
      const text = await response.text().catch(() => undefined);
      console.warn("[GoogleRoutes] Non-OK response", {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
    }

    return null;
  }

  const json = (await response.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };

  const route = json.routes?.[0];

  if (!route || !route.polyline?.encodedPolyline) {
    return null;
  }

  const points = decodePolyline(route.polyline.encodedPolyline);

  if (points.length < 2) {
    return null;
  }

  return {
    points,
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(route.duration)
  };
}
