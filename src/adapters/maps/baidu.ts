import { loadEnv } from "../../core/config/env";
import type { GeocodeOptions, MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const BAIDU_SUGGESTION_ENDPOINT = "https://api.map.baidu.com/place/v2/suggestion";
const LOCATION_SUFFIX_PATTERN = /(特别行政区|自治区|自治州|地区|盟|市|省|县|区)$/u;
const MATCH_CONFIDENCE_THRESHOLD = 0.75;
const CITY_APPROXIMATE_COORDS: Record<string, { lat: number; lng: number }> = {
  北京: { lat: 39.9042, lng: 116.4074 },
  上海: { lat: 31.2304, lng: 121.4737 },
  广州: { lat: 23.1291, lng: 113.2644 },
  深圳: { lat: 22.5431, lng: 114.0579 },
  南京: { lat: 32.0603, lng: 118.7969 },
  杭州: { lat: 30.2741, lng: 120.1551 },
  成都: { lat: 30.5728, lng: 104.0668 },
  武汉: { lat: 30.5931, lng: 114.3054 },
  西安: { lat: 34.3416, lng: 108.9398 },
  重庆: { lat: 29.563, lng: 106.5516 },
  天津: { lat: 39.3434, lng: 117.3616 },
  青岛: { lat: 36.0671, lng: 120.3826 },
  厦门: { lat: 24.4798, lng: 118.0894 }
};

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

function stripAdministrativeSuffix(value: string): string {
  let normalized = value.trim();

  while (LOCATION_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(LOCATION_SUFFIX_PATTERN, "");
  }

  return normalized;
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

function appendNote(baseNote: string | undefined, addition: string): string {
  if (!addition) {
    return baseNote ?? "";
  }

  if (!baseNote) {
    return addition;
  }

  return baseNote.includes(addition) ? baseNote : `${baseNote}（${addition}）`;
}

function buildMissingLocationHint(destination: string): string {
  return destination.trim()
    ? `未能在${destination}范围内找到可信地点，地图上将隐藏此活动。`
    : "未能在目的地范围内找到可信地点，地图上将隐藏此活动。";
}

function buildApproximateLocationHint(destination: string): string {
  return destination.trim()
    ? `未能定位到具体地点，已使用${destination}的大致范围。`
    : "未能定位到具体地点，已使用大致范围。";
}

function resolveApproximateCoords(destination: string): Pick<Place, "lat" | "lng"> | null {
  const trimmed = destination.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = stripAdministrativeSuffix(trimmed);
  const candidates = new Set<string>([normalized, trimmed]);

  for (const key of candidates) {
    const coords = CITY_APPROXIMATE_COORDS[key];

    if (coords) {
      return { lat: coords.lat, lng: coords.lng };
    }
  }

  return null;
}

function createApproximateActivity(activity: Activity, destination: string, place: Place): Activity {
  const hint = buildApproximateLocationHint(destination);
  const note = appendNote(activity.note, hint);
  const approximateAddress = activity.address ?? place.address ?? (destination.trim() || undefined);

  return {
    ...activity,
    lat: undefined,
    lng: undefined,
    address: approximateAddress,
    note,
    maps_confidence: undefined
  };
}

function withMissingLocationNote(activity: Activity, destination: string): Activity {
  const hint = buildMissingLocationHint(destination);
  const note = appendNote(activity.note, hint);

  return {
    ...activity,
    lat: undefined,
    lng: undefined,
    note,
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

      const minConfidence = Math.max(0, Math.min(1, options?.minConfidence ?? MATCH_CONFIDENCE_THRESHOLD));

      if (!best || best.confidence < minConfidence) {
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
    let destinationFallback: Place | null | undefined;

    const fetchDestinationFallback = async (): Promise<Place | null> => {
      if (destinationFallback !== undefined) {
        return destinationFallback;
      }

      if (!destination.trim()) {
        destinationFallback = null;
        return destinationFallback;
      }

      try {
        destinationFallback = await this.geocode(destination, destination, {
          referenceName: destination,
          minConfidence: 0.2
        });
      } catch {
        destinationFallback = null;
      }

      const approximateCoords = resolveApproximateCoords(destination);

      if (
        (!destinationFallback || destinationFallback.lat === undefined || destinationFallback.lng === undefined) &&
        approximateCoords
      ) {
        destinationFallback = {
          name: destination.trim() || "目的地",
          address: destination.trim() || undefined,
          city: destination.trim() || undefined,
          lat: approximateCoords.lat,
          lng: approximateCoords.lng,
          provider: "baidu",
          confidence: 0.2
        };
      }

      return destinationFallback;
    };

    for (const activity of activities) {
      const hasCoords = activity.lat !== undefined && activity.lng !== undefined;

      if (hasCoords) {
        enriched.push(activity);
        continue;
      }

      if (!activity.title) {
        enriched.push(activity);
        continue;
      }

      let matchedPlace: Place | null = null;

      try {
        const searchTerms = this.buildSearchTerms(destination, activity.title, activity.address, activity.note);

        for (const term of searchTerms) {
          matchedPlace = await this.geocode(term, destination, { referenceName: activity.title });

          if (matchedPlace) {
            break;
          }
        }
      } catch {
        /* noop to allow soft failure */
      }

      if (matchedPlace && typeof matchedPlace.lat === "number" && typeof matchedPlace.lng === "number") {
        enriched.push({
          ...activity,
          lat: matchedPlace.lat,
          lng: matchedPlace.lng,
          address: activity.address ?? matchedPlace.address,
          maps_confidence:
            typeof matchedPlace.confidence === "number"
              ? Math.min(Math.max(matchedPlace.confidence, 0), 1)
              : undefined
        });
        continue;
      }

      const fallbackPlace = await fetchDestinationFallback();

      if (fallbackPlace) {
        enriched.push(createApproximateActivity(activity, destination, fallbackPlace));
        continue;
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
