import type { Dispatcher } from "undici";
import { getGoogleMapsDispatcher } from "./googleDispatcher";

type FindPlaceCandidate = {
  name?: string;
  formatted_address?: string;
  photos?: Array<{ photo_reference?: string }>;
};

type FindPlaceResponse = {
  status?: string;
  candidates?: FindPlaceCandidate[];
  error_message?: string;
};

type SearchPlacePhotoOptions = {
  query: string;
  apiKey: string;
  destinationHint?: string;
  language?: string;
  maxResults?: number;
  maxWidth?: number;
};

type PlacePhotoSearchResult = {
  photos: string[];
  matchedName: string;
};

const FIND_PLACE_ENDPOINT = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const PLACE_PHOTO_ENDPOINT = "https://maps.googleapis.com/maps/api/place/photo";
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_MAX_WIDTH = 800;
const MIN_MATCH_SCORE = 0.6;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized.split(" ") : [];
}

function computeTokenOverlapScore(baseTokens: string[], candidateTokens: string[]): number {
  if (baseTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const baseSet = new Set(baseTokens);
  let overlap = 0;

  for (const token of candidateTokens) {
    if (baseSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(baseTokens.length, 1);
}

function computeMatchScore(query: string, candidate: FindPlaceCandidate, destinationHint?: string): number {
  const candidateName = candidate.name ?? "";
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidateName);

  if (!normalizedCandidate) {
    return 0;
  }

  if (normalizedCandidate === normalizedQuery) {
    return 1;
  }

  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return 1;
  }

  const baseTokens = tokenize(query);
  const candidateTokens = tokenize(candidateName);
  let score = computeTokenOverlapScore(baseTokens, candidateTokens);

  if (destinationHint) {
    const normalizedDestination = normalizeText(destinationHint);

    if (normalizedDestination && candidate.formatted_address) {
      const normalizedAddress = normalizeText(candidate.formatted_address);

      if (
        normalizedAddress.includes(normalizedDestination) ||
        normalizedDestination.includes(normalizedAddress)
      ) {
        score = Math.max(score, 0.75);
      }
    }
  }

  return score;
}

function buildPhotoUrl(photoReference: string, apiKey: string, maxWidth: number): string {
  const url = new URL(PLACE_PHOTO_ENDPOINT);
  url.searchParams.set("photo_reference", photoReference);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("maxwidth", String(maxWidth));
  return url.toString();
}

export async function searchPlacePhotosByName(
  options: SearchPlacePhotoOptions
): Promise<PlacePhotoSearchResult | null> {
  const { query, apiKey, destinationHint, language, maxResults, maxWidth } = options;
  const dispatcher = getGoogleMapsDispatcher();
  const fetchInit: RequestInit & { dispatcher?: Dispatcher } = { cache: "no-store" };

  if (dispatcher) {
    fetchInit.dispatcher = dispatcher;
  }

  const inputQuery = destinationHint ? `${query} ${destinationHint}`.trim() : query;

  const url = new URL(FIND_PLACE_ENDPOINT);
  url.searchParams.set("input", inputQuery.slice(0, 240));
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "name,photos,formatted_address");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", language ?? "en");
  url.searchParams.set("photoMetadatas", "true");

  let json: FindPlaceResponse | null = null;

  try {
    const response = await fetch(url.toString(), fetchInit);

    if (!response.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[GooglePlaces] Photo search request failed", {
          status: response.status,
          statusText: response.statusText
        });
      }

      return null;
    }

    json = (await response.json()) as FindPlaceResponse;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[GooglePlaces] Photo search threw", {
        query,
        destinationHint,
        error
      });
    }

    return null;
  }

  if (!json || json.status !== "OK" || !Array.isArray(json.candidates) || json.candidates.length === 0) {
    return null;
  }

  let bestCandidate: FindPlaceCandidate | null = null;
  let bestScore = 0;

  for (const candidate of json.candidates) {
    const score = computeMatchScore(query, candidate, destinationHint);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestScore < MIN_MATCH_SCORE) {
    return null;
  }

  const photos = (bestCandidate.photos ?? [])
    .map((entry) => entry.photo_reference)
    .filter((ref): ref is string => Boolean(ref))
    .slice(0, maxResults ?? DEFAULT_MAX_RESULTS)
    .map((ref) => buildPhotoUrl(ref, apiKey, maxWidth ?? DEFAULT_MAX_WIDTH));

  if (photos.length === 0) {
    return null;
  }

  return {
    photos,
    matchedName: bestCandidate.name ?? query
  };
}
