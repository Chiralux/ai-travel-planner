export type GoogleGeocodeOptions = {
  address: string;
  apiKey: string;
  language?: string;
  region?: string;
};

export type GoogleGeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress?: string;
  placeId?: string;
};

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocodeAddressWithGoogle(options: GoogleGeocodeOptions): Promise<GoogleGeocodeResult | null> {
  const { address, apiKey, language = "zh-CN", region } = options;

  if (!address.trim()) {
    return null;
  }

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", language);
  if (region) {
    url.searchParams.set("region", region);
  }

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{
        geometry?: {
          location?: {
            lat?: number;
            lng?: number;
          };
        };
        formatted_address?: string;
        place_id?: string;
      }>;
    };

    if (!payload || payload.status !== "OK" || !payload.results || payload.results.length === 0) {
      return null;
    }

    const first = payload.results[0];
    const coords = first?.geometry?.location;
    const lat = typeof coords?.lat === "number" ? coords.lat : undefined;
    const lng = typeof coords?.lng === "number" ? coords.lng : undefined;

    if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      formattedAddress: first.formatted_address,
      placeId: first.place_id
    };
  } catch {
    return null;
  }
}
