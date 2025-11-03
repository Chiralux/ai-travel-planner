import { Buffer } from "node:buffer";
import type { Dispatcher } from "undici";
import { getGoogleMapsDispatcher } from "./googleDispatcher";

export type StreetViewOptions = {
  lat: number;
  lng: number;
  apiKey: string;
  size?: string;
  radiusMeters?: number;
  source?: "default" | "outdoor";
};

export type StreetViewMetadata = {
  status?: string;
  pano_id?: string;
  copyright?: string;
  date?: string;
  location?: {
    lat?: number;
    lng?: number;
  };
};

export type StreetViewFetchResult = {
  status: string;
  url: string | null;
  imageDataUrl?: string | null;
  mimeType?: string;
  metadata?: StreetViewMetadata;
};

const METADATA_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview";
const DEFAULT_SIZE = "640x640";
const DEFAULT_RADIUS_METERS = 50;

function shouldRetryWithProxy(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as Error & { cause?: unknown };

  if (err.cause && typeof err.cause === "object" && err.cause !== null) {
    const causeWithCode = err.cause as { code?: unknown };

    if (typeof causeWithCode.code === "string") {
      const code = causeWithCode.code.toUpperCase();
      return code.includes("TIMEOUT") || code.includes("CONNECT");
    }
  }

  if (typeof err.message === "string") {
    const message = err.message.toLowerCase();
    return message.includes("timeout") || message.includes("connect");
  }

  return false;
}

function buildMetadataUrl({ lat, lng, apiKey, radiusMeters, source }: StreetViewOptions): string {
  const url = new URL(METADATA_ENDPOINT);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("radius", String(radiusMeters ?? DEFAULT_RADIUS_METERS));
  if (source) {
    url.searchParams.set("source", source);
  }

  return url.toString();
}

function buildImageUrl({ lat, lng, apiKey, size, source }: StreetViewOptions, metadata: StreetViewMetadata): string {
  const url = new URL(IMAGE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("size", size ?? DEFAULT_SIZE);
  url.searchParams.set("location", `${lat},${lng}`);
  if (metadata.pano_id) {
    url.searchParams.set("pano", metadata.pano_id);
  }
  if (source) {
    url.searchParams.set("source", source);
  }

  return url.toString();
}

export async function fetchStreetViewImage(options: StreetViewOptions): Promise<StreetViewFetchResult> {
  const dispatcher = getGoogleMapsDispatcher();
  const attempts: Array<{ useProxy: boolean }> = dispatcher
    ? [{ useProxy: false }, { useProxy: true }]
    : [{ useProxy: false }];

  let metadataUrl: string | undefined;
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      metadataUrl = buildMetadataUrl(options);
      const fetchInit: RequestInit & { dispatcher?: Dispatcher } = { cache: "no-store" };

      if (attempt.useProxy && dispatcher) {
        fetchInit.dispatcher = dispatcher;
      }

      const response = await fetch(metadataUrl, fetchInit);

      if (!response.ok) {
        return {
          status: `HTTP_${response.status}`,
          url: null
        };
      }

      const metadata = (await response.json()) as StreetViewMetadata;

      if (!metadata || metadata.status !== "OK") {
        return {
          status: metadata?.status ?? "UNKNOWN",
          url: null,
          metadata
        };
      }

      const imageUrl = buildImageUrl(options, metadata);
      const imageFetchInit: RequestInit & { dispatcher?: Dispatcher } = { cache: "no-store" };

      if (attempt.useProxy && dispatcher) {
        imageFetchInit.dispatcher = dispatcher;
      }

      const imageResponse = await fetch(imageUrl, imageFetchInit);

      if (!imageResponse.ok) {
        return {
          status: `HTTP_IMG_${imageResponse.status}`,
          url: null,
          metadata
        };
      }

      const buffer = await imageResponse.arrayBuffer();
      const mimeType = imageResponse.headers.get("content-type") ?? "image/jpeg";
      const base64 = Buffer.from(buffer).toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return {
        status: metadata.status,
        url: imageUrl,
        imageDataUrl: dataUrl,
        mimeType,
        metadata
      };
    } catch (error) {
      lastError = error;

      if (!attempt.useProxy && dispatcher && shouldRetryWithProxy(error)) {
        if (process.env.NODE_ENV !== "production") {
          const { apiKey: _apiKey, ...loggableOptions } = options;
          console.warn("[StreetView] Direct request failed, retrying with proxy", {
            metadataUrl,
            options: loggableOptions
          });
        }

        continue;
      }

      if (process.env.NODE_ENV !== "production") {
        const { apiKey: _apiKey, ...loggableOptions } = options;
        // Exclude API key from logs to avoid leaking credentials.
        const errorInfo =
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                cause: (error as Error & { cause?: unknown }).cause
              }
            : error;

        console.warn("[StreetView] Street View request failed", {
          metadataUrl,
          options: loggableOptions,
          usedProxy: attempt.useProxy,
          error: errorInfo
        });
      }

      break;
    }
  }

  const finalError = lastError;

  return {
    status:
      finalError instanceof Error ? `ERROR_${finalError.name || "UNKNOWN"}` : "ERROR_UNKNOWN",
    url: null,
    imageDataUrl: null
  };
}
