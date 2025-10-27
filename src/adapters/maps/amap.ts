import { loadEnv } from "../../core/config/env";
import type { GeocodeOptions, MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const AMAP_TEXT_ENDPOINT = "https://restapi.amap.com/v5/place/text";
const AMAP_NEW_POI_ENDPOINT = "https://restapi.amap.com/v5/place/fast";
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/;
const LOCATION_SUFFIX_PATTERN = /(特别行政区|自治区|自治州|地区|盟|市|省|县|区)$/u;
const MATCH_CONFIDENCE_THRESHOLD = 0.75;
const MAX_CANDIDATE_RESULTS = 5;
const CANDIDATE_CONFIDENCE_GAP = 0.12;
const HIGH_CONFIDENCE_OVERRIDE = 0.9;
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

function stripAdministrativeSuffix(value: string): string {
  let normalized = value.trim();

  while (LOCATION_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(LOCATION_SUFFIX_PATTERN, "");
  }

  return normalized;
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

function parsePoiLocation(poi: AMapPoi): { lat?: number; lng?: number } {
  if (!poi.location) {
    return {};
  }

  const [lngStr, latStr] = poi.location.split(",");
  const lng = Number(lngStr);
  const lat = Number(latStr);

  return {
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined
  };
}

function sanitizePhotoUrl(value?: string | null): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (!url.protocol.startsWith("http")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function extractPoiPhotos(poi: AMapPoi | undefined): string[] {
  if (!poi || !Array.isArray(poi.photos) || poi.photos.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const entry of poi.photos) {
    const candidate = sanitizePhotoUrl(entry?.url);

    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    urls.push(candidate);

    if (urls.length >= 6) {
      break;
    }
  }

  return urls;
}

type CandidateRole = "origin" | "destination" | "generic";

type KeyLocationHint = {
  pattern: RegExp;
  keywords: string[];
  role?: CandidateRole;
};

const KEY_LOCATION_HINTS: KeyLocationHint[] = [
  { pattern: /(火车站|铁路站|高铁站|train station|railway station)/i, keywords: ["火车站", "train station"], role: "generic" },
  { pattern: /(机场|航站楼|airport|terminal)/i, keywords: ["机场", "airport", "terminal"], role: "generic" },
  { pattern: /(巴士站|汽车站|长途车站|bus station|coach station)/i, keywords: ["汽车站", "bus station"], role: "generic" },
  { pattern: /(地铁站|subway station|metro station)/i, keywords: ["地铁站", "subway station", "metro station"], role: "generic" },
  { pattern: /(码头|港口|港湾|pier|ferry|harbor|harbour|port)/i, keywords: ["码头", "港口", "ferry terminal"], role: "generic" }
];

const TRAVEL_MODE_HINTS: Array<{ pattern: RegExp; preferredRoles: Array<{ keyword: string; role: CandidateRole }> }> = [
  {
    pattern: /(高铁|动车|bullet train|rail|火车|train)/i,
    preferredRoles: [
      { keyword: "火车站", role: "origin" },
      { keyword: "火车站", role: "destination" },
      { keyword: "train station", role: "origin" },
      { keyword: "train station", role: "destination" }
    ]
  },
  {
    pattern: /(飞机|航班|flight|airport|航站楼)/i,
    preferredRoles: [
      { keyword: "机场", role: "origin" },
      { keyword: "机场", role: "destination" },
      { keyword: "airport", role: "origin" },
      { keyword: "airport", role: "destination" }
    ]
  },
  {
    pattern: /(长途汽车|大巴|coach|bus)/i,
    preferredRoles: [
      { keyword: "汽车站", role: "origin" },
      { keyword: "汽车站", role: "destination" },
      { keyword: "bus station", role: "origin" },
      { keyword: "bus station", role: "destination" }
    ]
  }
];

function extractKeyLocationKeywords(
  sources: Array<{ text?: string; roleHint?: CandidateRole }>
): Array<{ keyword: string; role?: CandidateRole }> {
  const results = new Map<string, CandidateRole | undefined>();
  const aggregatedLowercaseText = sources
    .map((source) => source.text?.toLowerCase() ?? "")
    .join(" ");

  for (const source of sources) {
    if (!source.text) {
      continue;
    }

    for (const hint of KEY_LOCATION_HINTS) {
      if (hint.pattern.test(source.text)) {
        for (const keyword of hint.keywords) {
          const trimmed = keyword.trim();

          if (!trimmed) {
            continue;
          }

          const existingRole = results.get(trimmed);
          const candidateRole = source.roleHint ?? hint.role;

          if (!existingRole || existingRole === "generic") {
            results.set(trimmed, candidateRole ?? existingRole);
          }
        }
      }
    }
  }

  for (const mode of TRAVEL_MODE_HINTS) {
    if (!mode.pattern.test(aggregatedLowercaseText)) {
      continue;
    }

    for (const preference of mode.preferredRoles) {
      const existingRole = results.get(preference.keyword);

      if (!existingRole || existingRole === "generic") {
        results.set(preference.keyword, preference.role);
      }
    }
  }

  return Array.from(results.entries()).map(([keyword, role]) => ({ keyword, role }));
}

type CandidateEntry = {
  poi: AMapPoi;
  confidence: number;
  term: string;
  lat: number;
  lng: number;
  photos: string[];
  role?: CandidateRole;
};

function candidateKey(poi: AMapPoi): string {
  return [poi.name ?? "", poi.address ?? "", poi.adname ?? "", poi.location ?? ""].join("|");
}

function toPlace(candidate: CandidateEntry, fallbackName: string): Place {
  const poi = candidate.poi;

  return {
    name: poi.name ?? fallbackName,
    address: poi.address || poi.adname || poi.district,
    city: poi.cityname,
    lat: candidate.lat,
    lng: candidate.lng,
    provider: "amap",
    raw: poi,
    confidence: candidate.confidence
  };
}

function buildAmbiguityNote(candidates: CandidateEntry[], searchTerms: string[]): string {
  const descriptions = candidates.map((candidate, index) => {
    const name = candidate.poi.name ?? "候选地点";
    const address = candidate.poi.address || candidate.poi.adname || candidate.poi.district || "地址未知";
    const coords = `${candidate.lat.toFixed(4)},${candidate.lng.toFixed(4)}`;
    const confidence = candidate.confidence.toFixed(2);
    return `${index + 1}. ${name}（${address}，置信度${confidence}，关键词: ${candidate.term}，坐标: ${coords}）`;
  });

  const candidatesText = descriptions.join("；");
  const keywordCandidates = Array.from(
    new Set(searchTerms.map((term) => term.trim()).filter((term) => term.length > 0))
  );
  const keywordsText = keywordCandidates.length > 0 ? `搜索关键词：${keywordCandidates.slice(0, 5).join(" / ")}` : "";
  const base = `地图候选待AI确认：${candidatesText}`;

  return keywordsText ? `${base}。${keywordsText}` : base;
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

type AMapPoi = {
  name?: string;
  address?: string;
  district?: string;
  cityname?: string;
  adname?: string;
  location?: string;
  photos?: Array<{ url?: string }>;
};

type AMapTextResponse = {
  status?: string;
  info?: string;
  infocode?: string;
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

    const referenceName = options?.referenceName ?? query;
    const minConfidence = Math.max(0, Math.min(1, options?.minConfidence ?? MATCH_CONFIDENCE_THRESHOLD));

    const newPoiCandidates = await this.fetchNewPoiCandidates(query, cityOrDestination, referenceName);
    const strongNewPoi = newPoiCandidates.find((candidate) => candidate.confidence >= minConfidence);

    if (strongNewPoi) {
      return toPlace(strongNewPoi, referenceName);
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: query,
      page_size: "5",
      page_num: "1",
      output: "JSON",
      sortrule: "weight",
      show_fields: "photos"
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
        poiMatchesDestination(cityOrDestination, poiCandidate, referenceName)
      );

      if (filteredPois.length === 0) {
        return null;
      }

      const evaluated = filteredPois
        .map((poi) => ({ poi, confidence: evaluatePoiConfidence(referenceName, poi) }))
        .sort((a, b) => b.confidence - a.confidence);

      const best = evaluated[0];

      if (!best || best.confidence < minConfidence) {
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

  private async fetchCandidates(
    term: string,
    cityOrDestination: string | undefined,
    referenceName: string,
    roleHint?: CandidateRole
  ): Promise<CandidateEntry[]> {
    const query = term.trim();

    if (!query) {
      return [];
    }

    if (!this.apiKey) {
      if (!this.warnedMissingKey && process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] Missing AMAP_REST_KEY, skipping geocode lookups.");
        this.warnedMissingKey = true;
      }

      return [];
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: query,
      page_size: "5",
      page_num: "1",
      output: "JSON",
      sortrule: "weight",
      show_fields: "photos"
    });

    if (cityOrDestination) {
      params.set("region", cityOrDestination);
      params.set("city", cityOrDestination);
    }

    try {
      const response = await requestJson<AMapTextResponse>(`${AMAP_TEXT_ENDPOINT}?${params.toString()}`);

      if (response.status !== "1" || !Array.isArray(response.pois) || response.pois.length === 0) {
        return [];
      }

      const filteredPois = response.pois.filter((poiCandidate) =>
        poiMatchesDestination(cityOrDestination, poiCandidate, referenceName ?? query)
      );

      const evaluated = filteredPois
        .map((poi) => ({ poi, confidence: evaluatePoiConfidence(referenceName ?? query, poi) }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_CANDIDATE_RESULTS * 2);

      const candidates: CandidateEntry[] = [];

      for (const item of evaluated) {
        const location = parsePoiLocation(item.poi);

        if (location.lat === undefined || location.lng === undefined) {
          continue;
        }

        candidates.push({
          poi: item.poi,
          confidence: item.confidence,
          term: query,
          lat: location.lat,
          lng: location.lng,
          photos: extractPoiPhotos(item.poi),
          role: roleHint
        });

        if (candidates.length >= MAX_CANDIDATE_RESULTS) {
          break;
        }
      }

      const needsMoreCandidates =
        candidates.length === 0 || candidates.every((entry) => entry.confidence < MATCH_CONFIDENCE_THRESHOLD);

      if (needsMoreCandidates) {
  const newPoiCandidates = await this.fetchNewPoiCandidates(query, cityOrDestination, referenceName, roleHint);

        for (const candidate of newPoiCandidates) {
          const key = candidateKey(candidate.poi);
          const exists = candidates.some((entry) => candidateKey(entry.poi) === key);

          if (exists) {
            continue;
          }

          candidates.push(candidate);

          if (candidates.length >= MAX_CANDIDATE_RESULTS) {
            break;
          }
        }
      }

      return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_CANDIDATE_RESULTS);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] Candidate fetch failed", error);
      }

      return [];
    }
  }

  private async fetchNewPoiCandidates(
    term: string,
    cityOrDestination: string | undefined,
    referenceName: string,
    roleHint?: CandidateRole
  ): Promise<CandidateEntry[]> {
    const query = term.trim();

    if (!query) {
      return [];
    }

    if (!this.apiKey) {
      if (!this.warnedMissingKey && process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] Missing AMAP_REST_KEY, skipping new POI lookups.");
        this.warnedMissingKey = true;
      }

      return [];
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: query,
      output: "JSON",
      page_size: "10",
      page_num: "1",
      show_fields: "photos"
    });

    if (cityOrDestination) {
      params.set("region", cityOrDestination);
      params.set("city", cityOrDestination);
      params.set("city_limit", "true");
    }

    try {
      const response = await requestJson<AMapTextResponse>(`${AMAP_NEW_POI_ENDPOINT}?${params.toString()}`);

      if (response.status !== "1" || !Array.isArray(response.pois) || response.pois.length === 0) {
        return [];
      }

      const filteredPois = response.pois.filter((poiCandidate) =>
        poiMatchesDestination(cityOrDestination, poiCandidate, referenceName ?? query)
      );

      if (filteredPois.length === 0) {
        return [];
      }

      const evaluated = filteredPois
        .map((poi) => ({ poi, confidence: evaluatePoiConfidence(referenceName ?? query, poi) }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_CANDIDATE_RESULTS * 2);

      const candidates: CandidateEntry[] = [];

      for (const item of evaluated) {
        const location = parsePoiLocation(item.poi);

        if (location.lat === undefined || location.lng === undefined) {
          continue;
        }

        candidates.push({
          poi: item.poi,
          confidence: item.confidence,
          term: query,
          lat: location.lat,
          lng: location.lng,
          photos: extractPoiPhotos(item.poi),
          role: roleHint
        });

        if (candidates.length >= MAX_CANDIDATE_RESULTS) {
          break;
        }
      }

      return candidates;
    } catch (error: unknown) {
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
      const is404Message =
        status === undefined &&
        error instanceof Error &&
        typeof error.message === "string" &&
        error.message.includes("status 404");

      if (status !== 404 && !is404Message && process.env.NODE_ENV !== "production") {
        console.warn("[maps][amap] New POI candidate fetch failed", error);
      }

      return [];
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
          provider: "amap",
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

      const searchTerms = this.buildSearchTerms(destination, activity.title, activity.address, activity.note);

      try {
        const candidateMap = new Map<string, CandidateEntry>();

        for (const searchTerm of searchTerms) {
          const candidates = await this.fetchCandidates(
            searchTerm.term,
            destination,
            activity.title ?? searchTerm.term,
            searchTerm.role
          );

          for (const candidate of candidates) {
            const key = candidateKey(candidate.poi);
            const existing = candidateMap.get(key);

            if (!existing || candidate.confidence > existing.confidence) {
              candidateMap.set(key, candidate);
              continue;
            }

            if ((!existing.role || existing.role === "generic") && candidate.role && candidate.role !== "generic") {
              candidateMap.set(key, { ...existing, role: candidate.role });
            }

            if (existing.photos.length === 0 && candidate.photos.length > 0) {
              candidateMap.set(key, { ...existing, photos: candidate.photos });
            }
          }
        }

        let sortedCandidates = Array.from(candidateMap.values())
          .filter((entry) => entry.confidence >= MATCH_CONFIDENCE_THRESHOLD)
          .sort((a, b) => b.confidence - a.confidence);

        if (sortedCandidates.length === 0) {
          const fallbackCandidates = await this.fetchNewPoiCandidates(
            activity.title,
            destination,
            activity.title ?? searchTerms[0]?.term ?? "",
            searchTerms[0]?.role
          );

          for (const candidate of fallbackCandidates) {
            const key = candidateKey(candidate.poi);
            const existing = candidateMap.get(key);

            if (!existing || candidate.confidence > existing.confidence) {
              candidateMap.set(key, candidate);
              continue;
            }

            if ((!existing.role || existing.role === "generic") && candidate.role && candidate.role !== "generic") {
              candidateMap.set(key, { ...existing, role: candidate.role });
            }

            if (existing.photos.length === 0 && candidate.photos.length > 0) {
              candidateMap.set(key, { ...existing, photos: candidate.photos });
            }
          }

          sortedCandidates = Array.from(candidateMap.values())
            .filter((entry) => entry.confidence >= MATCH_CONFIDENCE_THRESHOLD)
            .sort((a, b) => b.confidence - a.confidence);
        }

        const topCandidates = sortedCandidates.slice(0, MAX_CANDIDATE_RESULTS);

        if (topCandidates.length > 0) {
          const best = topCandidates[0];
          const second = topCandidates[1];
          const acceptBestCandidate =
            !second ||
            best.confidence - second.confidence >= CANDIDATE_CONFIDENCE_GAP ||
            best.confidence >= HIGH_CONFIDENCE_OVERRIDE;

          if (acceptBestCandidate) {
            const bestPoi = best.poi;
            const place: Place = {
              name: bestPoi.name ?? (activity.title ?? best.term),
              address: bestPoi.address || bestPoi.adname || bestPoi.district,
              city: bestPoi.cityname,
              lat: best.lat,
              lng: best.lng,
              provider: "amap",
              raw: bestPoi,
              confidence: best.confidence
            };

            const originalTitle = activity.title ?? "";
            const placeName = place.name;
            const usePlaceName =
              !CHINESE_CHAR_REGEX.test(originalTitle) && CHINESE_CHAR_REGEX.test(placeName);
            const nextTitle = usePlaceName ? placeName : originalTitle;
            const nextAddress = activity.address ?? place.address;
            const candidatePhotos = best.photos.length > 0 ? best.photos : extractPoiPhotos(best.poi);
            const nextPhotos = candidatePhotos.length > 0 ? candidatePhotos : activity.photos;

            enriched.push({
              ...activity,
              lat: place.lat,
              lng: place.lng,
              address: nextAddress,
              title: nextTitle,
              maps_confidence: Math.min(Math.max(place.confidence ?? MATCH_CONFIDENCE_THRESHOLD, 0), 1),
              photos: nextPhotos
            });
            continue;
          }

          const ambiguityNote = buildAmbiguityNote(
            topCandidates,
            searchTerms.map((entry) => entry.term)
          );
          const note = appendNote(activity.note, ambiguityNote);

          enriched.push({
            ...activity,
            lat: undefined,
            lng: undefined,
            note,
            maps_confidence: undefined
          });
          continue;
        }
      } catch {
        /* swallow to keep soft failure */
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
  ): Array<{ term: string; role?: CandidateRole }> {
    const terms = new Map<string, CandidateRole | undefined>();

    const clean = (value?: string) => value?.trim();
    const cleanedDestination = clean(destination);
    const cleanedTitle = clean(title);
    const cleanedAddress = clean(address);
    const cleanedNote = clean(note);
    const keyLocationKeywords = extractKeyLocationKeywords([
      { text: cleanedTitle },
      { text: cleanedAddress },
      { text: cleanedNote },
      { text: cleanedDestination }
    ]);

    const addTerm = (value?: string, role?: CandidateRole) => {
      const trimmed = value?.trim();

      if (!trimmed) {
        return;
      }

      const existingRole = terms.get(trimmed);

      if (!existingRole || existingRole === "generic") {
        terms.set(trimmed, role ?? existingRole);
      }
    };

    if (cleanedTitle && cleanedAddress) {
      addTerm(`${cleanedTitle} ${cleanedAddress}`);
    }

    if (cleanedDestination && cleanedAddress) {
      addTerm(`${cleanedDestination} ${cleanedAddress}`);
    }

    if (cleanedDestination && cleanedTitle) {
      addTerm(`${cleanedDestination} ${cleanedTitle}`);
    }

    if (cleanedTitle && cleanedNote) {
      addTerm(`${cleanedTitle} ${cleanedNote}`);
    }

    addTerm(cleanedAddress);
    addTerm(cleanedTitle);
    addTerm(cleanedNote);

    for (const { keyword, role } of keyLocationKeywords) {
      addTerm(keyword, role);

      if (cleanedDestination) {
        addTerm(`${cleanedDestination} ${keyword}`, role);
        addTerm(`${keyword} ${cleanedDestination}`, role);
      }

      if (cleanedTitle) {
        addTerm(`${cleanedTitle} ${keyword}`, role);
      }

      if (cleanedAddress) {
        addTerm(`${cleanedAddress} ${keyword}`, role);
      }
    }

    return Array.from(terms.entries()).map(([term, role]) => ({ term, role }));
  }
}
