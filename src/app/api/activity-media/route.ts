import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadEnv } from "../../../core/config/env";
import { fetchStreetViewImage } from "../../../adapters/maps/googleStreetView";
import { geocodeAddressWithGoogle } from "../../../adapters/maps/googleGeocode";
import { searchPlacePhotosByName } from "../../../adapters/maps/googlePlacesPhotos";
import { isCoordinateInChina } from "../../../lib/maps/provider";
import { GEOCODED_CONFIDENCE, MAX_NAME_BASED_PHOTOS } from "../../../services/ItineraryService";

const activityMediaRequestSchema = z
  .object({
    streetView: z
      .object({
        lat: z.number().optional(),
        lng: z.number().optional(),
        addressCandidates: z.array(z.string()).optional(),
        minConfidence: z.number().min(0).max(1).optional()
      })
      .optional(),
    placePhotos: z
      .object({
        query: z.string().min(1),
        destination: z.string().optional(),
        language: z.string().optional(),
        maxResults: z.number().int().positive().optional()
      })
      .optional()
  })
  .optional();

const requestSchema = z.object({
  destination: z.string().min(1),
  activity: z.object({
    title: z.string().min(1),
    note: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    maps_confidence: z.number().min(0).max(1).optional(),
    photos: z.array(z.string().url()).optional(),
    media_requests: activityMediaRequestSchema
  })
});

function appendNote(base: string | undefined, addition: string): string {
  if (!addition) {
    return base ?? "";
  }

  if (!base) {
    return addition;
  }

  return base.includes(addition) ? base : `${base}（${addition}）`;
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { destination, activity } = parsed.data;

  if (!activity.media_requests) {
    return NextResponse.json({ ok: true, data: {} }, { status: 200 });
  }

  const env = loadEnv();
  const googleApiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!googleApiKey) {
    return NextResponse.json(
      { ok: false, error: "Google Maps API key not configured" },
      { status: 503 }
    );
  }

  const existingPhotos = new Set(activity.photos ?? []);
  const newPhotos: string[] = [];
  let note = activity.note;
  let mapsConfidence =
    typeof activity.maps_confidence === "number" && Number.isFinite(activity.maps_confidence)
      ? activity.maps_confidence
      : undefined;

  const streetRequest = activity.media_requests.streetView;
  const placePhotoRequest = activity.media_requests.placePhotos;

  if (streetRequest) {
    let coordinate: { lat: number; lng: number } | null = null;
    let resolvedFromGeocode = false;

    if (
      typeof streetRequest.lat === "number" &&
      Number.isFinite(streetRequest.lat) &&
      typeof streetRequest.lng === "number" &&
      Number.isFinite(streetRequest.lng)
    ) {
      coordinate = { lat: streetRequest.lat, lng: streetRequest.lng };
    }

    if (!coordinate && streetRequest.addressCandidates?.length) {
      for (const candidate of streetRequest.addressCandidates) {
        const geocoded = await geocodeAddressWithGoogle({
          address: candidate,
          apiKey: googleApiKey,
          language: placePhotoRequest?.language ?? "zh-CN"
        });

        if (geocoded) {
          coordinate = { lat: geocoded.lat, lng: geocoded.lng };
          resolvedFromGeocode = true;
          break;
        }
      }
    }

    if (coordinate && !isCoordinateInChina(coordinate)) {
      const streetViewResult = await fetchStreetViewImage({
        lat: coordinate.lat,
        lng: coordinate.lng,
        apiKey: googleApiKey,
        size: "640x640",
        source: "outdoor"
      });

      if (streetViewResult.url) {
        if (!existingPhotos.has(streetViewResult.url)) {
          newPhotos.push(streetViewResult.url);
          existingPhotos.add(streetViewResult.url);
        }
        note = appendNote(note, "附加了 Google 街景图像，请确认实际情况。");
        if (resolvedFromGeocode) {
          const uplift = Math.max(streetRequest.minConfidence ?? 0, GEOCODED_CONFIDENCE);
          mapsConfidence = Math.max(mapsConfidence ?? 0, uplift);
        } else if (typeof streetRequest.minConfidence === "number") {
          mapsConfidence = Math.max(mapsConfidence ?? 0, streetRequest.minConfidence);
        }
      } else {
        const status = streetViewResult.status || "UNKNOWN";
        note = appendNote(note, `未能获取 Google 街景（状态：${status}）`);
        if (typeof streetRequest.minConfidence === "number") {
          mapsConfidence = Math.max(mapsConfidence ?? 0, streetRequest.minConfidence);
        }
      }
    }
  }

  if (placePhotoRequest) {
    try {
      const response = await searchPlacePhotosByName({
        query: placePhotoRequest.query,
        destinationHint: placePhotoRequest.destination ?? destination,
        apiKey: googleApiKey,
        language: placePhotoRequest.language ?? "en",
        maxResults: Math.min(placePhotoRequest.maxResults ?? MAX_NAME_BASED_PHOTOS, MAX_NAME_BASED_PHOTOS)
      });

      if (response?.photos?.length) {
        for (const photo of response.photos) {
          if (!existingPhotos.has(photo)) {
            newPhotos.push(photo);
            existingPhotos.add(photo);
          }
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[activity-media] Name-based photo lookup failed", {
          destination,
          query: placePhotoRequest.query,
          error
        });
      }
    }
  }

  const responsePayload: {
    photos?: string[];
    note?: string;
    maps_confidence?: number;
  } = {};

  if (newPhotos.length > 0) {
    responsePayload.photos = newPhotos;
  }

  if (typeof note === "string" && note !== activity.note) {
    responsePayload.note = note;
  }

  if (
    typeof mapsConfidence === "number" &&
    (activity.maps_confidence == null || Math.abs(mapsConfidence - activity.maps_confidence) > 1e-6)
  ) {
    responsePayload.maps_confidence = Math.min(Math.max(mapsConfidence, 0), 1);
  }

  return NextResponse.json({ ok: true, data: responsePayload }, { status: 200 });
}
