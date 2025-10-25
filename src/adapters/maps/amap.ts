import { loadEnv } from "../../core/config/env";
import type { GeocodeOptions, MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const AMAP_TEXT_ENDPOINT = "https://restapi.amap.com/v5/place/text";
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/;
const LOCATION_SUFFIX_PATTERN = /(特别行政区|自治区|自治州|地区|盟|市|省|县|区)$/u;
const MATCH_CONFIDENCE_THRESHOLD = 0.75;

function normalizeLocationText(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const chineseOnly = value.replace(new RegExp("[^\\u4e00-\\u9fff]", "gu"), "");

  if (!chineseOnly) {
    return null;
  }

  let normalized = chineseOnly;

  while (LOCATION_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(LOCATION_SUFFIX_PATTERN, "");
  }

  return normalized || null;
}

function normalizeMatchText(value: string): string {
  return value.replace(/[^\u4e00-\u9fff0-9a-z]/gi, "").toLowerCase();
}

function computeMatchConfidence(reference: string, candidate?: string | null): number {
  if (!candidate) {
    return 0;
  }

  const normalizedQuery = normalizeMatchText(reference);
  const normalizedCandidate = normalizeMatchText(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (
    normalizedQuery.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedQuery)
  ) {
    return 1;
  }

  const queryChars = new Set(Array.from(normalizedQuery));
  const candidateChars = new Set(Array.from(normalizedCandidate));
  let intersection = 0;

  for (const char of candidateChars) {
    if (queryChars.has(char)) {
      intersection += 1;
    }
  }

  const smallestSize = Math.min(queryChars.size, candidateChars.size);

  if (smallestSize === 0) {
    return 0;
  }

  return intersection / smallestSize;
}

function evaluatePoiConfidence(reference: string, poi: AMapPoi): number {
  const confidenceSources = [poi.name, poi.address, poi.adname, poi.district];
  const confidences = confidenceSources.map((source) => computeMatchConfidence(reference, source));
  return Math.max(...confidences, 0);
}

function poiMatchesDestination(
  destination: string | undefined,
  poi: AMapPoi,
  queryHint?: string
): boolean {
  const normalizedDestination = normalizeLocationText(destination);
  const normalizedQueryHint = normalizeLocationText(queryHint);

  const candidates = [poi.cityname, poi.adname, poi.district, poi.address, poi.name]
    .map((candidate) => normalizeLocationText(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (candidates.length === 0) {
    return false;
  }

  if (normalizedDestination) {
    const matchesDestination = candidates.some((candidate) => {
      return normalizedDestination.includes(candidate) || candidate.includes(normalizedDestination);
    });

    if (matchesDestination) {
      return true;
    }
  }

  if (normalizedQueryHint) {
    return candidates.some((candidate) => {
      return normalizedQueryHint.includes(candidate) || candidate.includes(normalizedQueryHint);
    });
  }

  return !normalizedDestination;
}

function withMissingLocationNote(activity: Activity, destination: string): Activity {
  const locationHint = destination.trim()
    ? `未能在${destination}范围内找到可信地点，地图上将隐藏此活动。`
    : "未能找到可信地点，地图上将隐藏此活动。";

  if (activity.note?.includes(locationHint)) {
    return { ...activity, lat: undefined, lng: undefined, maps_confidence: undefined };
  }

  const nextNote = activity.note ? `${activity.note}（${locationHint}）` : locationHint;

  return {
    ...activity,
    lat: undefined,
    lng: undefined,
    note: nextNote,
    maps_confidence: undefined
  };
}

type AMapPoi = {
  name?: string;
  address?: string;
  district?: string;
  cityname?: string;
  adname?: string;
  location?: string;
};

type AMapTextResponse = {
  status?: string;
  info?: string;
  pois?: AMapPoi[];
};

export class AMapClient implements MapsClient {
  private readonly apiKey?: string;
  private warnedMissingKey = false;

  constructor(apiKey?: string) {
    const env = loadEnv();
    this.apiKey = apiKey ?? env.AMAP_REST_KEY;
  }

  async geocode(name: string, cityOrDestination?: string, options?: GeocodeOptions): Promise<Place | null> {
    const query = name.trim();

    if (!query) {
      return null;
    }

    if (!this.apiKey) {
      if (!this.warnedMissingKey && process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] Missing AMAP_REST_KEY, skipping geocode lookups.");
        this.warnedMissingKey = true;
      }

      return null;
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: query,
  page_size: "5",
      page_num: "1",
      output: "JSON",
      sortrule: "weight"
    });

    if (cityOrDestination) {
      params.set("region", cityOrDestination);
      params.set("city", cityOrDestination);
    }

    try {
      const response = await requestJson<AMapTextResponse>(`${AMAP_TEXT_ENDPOINT}?${params.toString()}`);

      if (response.status !== "1" || !Array.isArray(response.pois) || response.pois.length === 0) {
        return null;
      }

      const filteredPois = response.pois.filter((poiCandidate) =>
        poiMatchesDestination(cityOrDestination, poiCandidate, options?.referenceName ?? query)
      );

      if (filteredPois.length === 0) {
        return null;
      }

      const evaluated = filteredPois
        .map((poi) => ({ poi, confidence: evaluatePoiConfidence(options?.referenceName ?? query, poi) }))
        .sort((a, b) => b.confidence - a.confidence);

      const best = evaluated[0];

      if (!best || best.confidence < MATCH_CONFIDENCE_THRESHOLD) {
        return null;
      }

      const poi = best.poi;
      const [lngStr, latStr] = (poi.location ?? "").split(",");
      const lng = Number(lngStr);
      const lat = Number(latStr);

      return {
        name: poi.name ?? query,
        address: poi.address || poi.adname || poi.district,
        city: poi.cityname,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        provider: "amap",
        raw: poi,
        confidence: best.confidence
      };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] Geocode request failed", error);
      }

      return null;
    }
  }

  async enrichActivities(destination: string, activities: Activity[]): Promise<Activity[]> {
    const enriched: Activity[] = [];

    for (const activity of activities) {
      const hasCoords = activity.lat !== undefined && activity.lng !== undefined;

      // If activity already has coordinates, prefer them over geocoding
      if (hasCoords) {
        enriched.push(activity);
        continue;
      }

      // Skip if no title to search for
      if (!activity.title) {
        enriched.push(activity);
        continue;
      }

      try {
        const searchTerms = this.buildSearchTerms(destination, activity.title, activity.address, activity.note);

        let place: Place | null = null;

        for (const term of searchTerms) {
          place = await this.geocode(term, destination, { referenceName: activity.title });

          if (place) {
            break;
          }
        }

        if (place) {
          const originalTitle = activity.title ?? "";
          const placeName = typeof place.name === "string" ? place.name : undefined;
          const usePlaceName = !CHINESE_CHAR_REGEX.test(originalTitle) && placeName && CHINESE_CHAR_REGEX.test(placeName);
          const nextTitle = usePlaceName && placeName ? placeName : originalTitle;
          const nextAddress = activity.address ?? place.address;

          // Only use geocoded coordinates if activity doesn't already have them
          enriched.push({
            ...activity,
            lat: place.lat,
            lng: place.lng,
            address: nextAddress,
            title: nextTitle,
            maps_confidence: place.confidence
          });
          continue;
        }
      } catch {
        /* swallow to keep soft failure */
      }

      enriched.push(withMissingLocationNote(activity, destination));
    }

    return enriched;
  }

  private buildSearchTerms(
    destination: string,
    title?: string,
    address?: string,
    note?: string
  ): string[] {
    const terms = new Set<string>();

    const clean = (value?: string) => value?.trim();
    const cleanedDestination = clean(destination);
    const cleanedTitle = clean(title);
    const cleanedAddress = clean(address);
    const cleanedNote = clean(note);

    if (cleanedTitle && cleanedAddress) {
      terms.add(`${cleanedTitle} ${cleanedAddress}`);
    }

    if (cleanedDestination && cleanedAddress) {
      terms.add(`${cleanedDestination} ${cleanedAddress}`);
    }

    if (cleanedDestination && cleanedTitle) {
      terms.add(`${cleanedDestination} ${cleanedTitle}`);
    }

    if (cleanedTitle && cleanedNote) {
      terms.add(`${cleanedTitle} ${cleanedNote}`);
    }

    if (cleanedAddress) {
      terms.add(cleanedAddress);
    }

    if (cleanedTitle) {
      terms.add(cleanedTitle);
    }

    if (cleanedNote) {
      terms.add(cleanedNote);
    }

    return Array.from(terms);
  }
}
