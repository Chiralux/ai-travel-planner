import { loadEnv } from "../../core/config/env";
import type { GeocodeOptions, MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const BAIDU_SUGGESTION_ENDPOINT = "https://api.map.baidu.com/place/v2/suggestion";
const LOCATION_SUFFIX_PATTERN = /(特别行政区|自治区|自治州|地区|盟|市|省|县|区)$/u;
const MATCH_CONFIDENCE_THRESHOLD = 0.75;

function normalizeLocationText(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const chineseOnly = value.replace(/[^\u4e00-\u9fff]/g, "");

  if (!chineseOnly) {
    return null;
  }

  let normalized = chineseOnly;

  while (LOCATION_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(LOCATION_SUFFIX_PATTERN, "");
  }

  return normalized || null;
}

function suggestionMatchesDestination(
  destination: string | undefined,
  suggestion: BaiduSuggestion,
  queryHint?: string
): boolean {
  const normalizedDestination = normalizeLocationText(destination);
  const normalizedQueryHint = normalizeLocationText(queryHint);

  const candidates = [suggestion.city, suggestion.district, suggestion.address, suggestion.name]
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

function evaluateSuggestionConfidence(reference: string, suggestion: BaiduSuggestion): number {
  const confidenceSources = [suggestion.name, suggestion.address, suggestion.district, suggestion.city];
  const confidences = confidenceSources.map((source) => computeMatchConfidence(reference, source));
  return Math.max(...confidences, 0);
}

type BaiduSuggestion = {
  name?: string;
  address?: string;
  district?: string;
  city?: string;
  location?: {
    lat?: number;
    lng?: number;
  };
};

type BaiduSuggestionResponse = {
  status?: number;
  message?: string;
  result?: BaiduSuggestion[];
};

export class BaiduMapClient implements MapsClient {
  private readonly apiKey?: string;
  private warnedMissingKey = false;

  constructor(apiKey?: string) {
    const env = loadEnv();
    this.apiKey = apiKey ?? env.BAIDU_MAP_AK;
  }

  async geocode(name: string, cityOrDestination?: string, options?: GeocodeOptions): Promise<Place | null> {
    const query = name.trim();

    if (!query) {
      return null;
    }

    if (!this.apiKey) {
      if (!this.warnedMissingKey && process.env.NODE_ENV !== "production") {
        console.warn("[maps][baidu] Missing BAIDU_MAP_AK, skipping geocode lookups.");
        this.warnedMissingKey = true;
      }

      return null;
    }

    const params = new URLSearchParams({
      query,
      ak: this.apiKey,
      output: "json",
      ret_coordtype: "gcj02ll"
    });

    if (cityOrDestination) {
      params.set("region", cityOrDestination);
    }

    try {
      const response = await requestJson<BaiduSuggestionResponse>(
        `${BAIDU_SUGGESTION_ENDPOINT}?${params.toString()}`
      );

      if (response.status !== 0 || !Array.isArray(response.result) || response.result.length === 0) {
        return null;
      }

      const candidates = response.result.filter((item) =>
        suggestionMatchesDestination(cityOrDestination, item, options?.referenceName ?? query)
      );

      if (candidates.length === 0) {
        return null;
      }

      const evaluated = candidates
        .map((candidate) => ({ candidate, confidence: evaluateSuggestionConfidence(options?.referenceName ?? query, candidate) }))
        .sort((a, b) => b.confidence - a.confidence);

      const best = evaluated[0];

      if (!best || best.confidence < MATCH_CONFIDENCE_THRESHOLD) {
        return null;
      }

      const suggestion = best.candidate;
      const lat = suggestion.location?.lat;
      const lng = suggestion.location?.lng;

      return {
        name: suggestion.name ?? query,
        address: suggestion.address || suggestion.district,
        city: suggestion.city,
        lat: typeof lat === "number" ? lat : undefined,
        lng: typeof lng === "number" ? lng : undefined,
        provider: "baidu",
        raw: suggestion,
        confidence: best.confidence
      };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[maps][baidu] Geocode request failed", error);
      }

      return null;
    }
  }

  async enrichActivities(destination: string, activities: Activity[]): Promise<Activity[]> {
    const enriched: Activity[] = [];

    for (const activity of activities) {
      const hasCoords = activity.lat !== undefined && activity.lng !== undefined;

      if ((hasCoords && activity.address) || !activity.title) {
        enriched.push(activity);
        continue;
      }

      try {
  const place = await this.geocode(activity.title, destination, { referenceName: activity.title });

        if (place) {
          enriched.push({
            ...activity,
            lat: activity.lat ?? place.lat,
            lng: activity.lng ?? place.lng,
            address: activity.address ?? place.address,
            maps_confidence: place.confidence
          });
          continue;
        }
      } catch {
        /* noop to allow soft failure */
      }

      enriched.push(withMissingLocationNote(activity, destination));
    }

    return enriched;
  }
}
