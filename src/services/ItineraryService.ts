import { createHash } from "crypto";
import type { Dispatcher } from "undici";
import Redis from "ioredis";
import type { MapsClient } from "../core/ports/maps";
import type {
  LLMClient,
  GenerateItineraryInput,
  LocationRefinementResult
} from "../core/ports/llm";
import { itinerarySchema, type BudgetBreakdown, type Itinerary } from "../core/validation/itinerarySchema";
import { loadEnv } from "../core/config/env";
import { isCoordinateInChina } from "../lib/maps/provider";
import { generateAddressCandidates } from "../core/utils/addressCandidates";
import { getGoogleMapsDispatcher } from "../adapters/maps/googleDispatcher";

const CACHE_PREFIX = "itinerary";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache window
const LLM_LOCATION_CONFIDENCE_THRESHOLD = 0.45;
const LLM_LOCATION_MIN_CONFIDENCE = 0.35;
const AI_LOCATION_NOTE = "位置信息由AI辅助推断，请注意核实。";
export const STREET_VIEW_CONFIDENCE_THRESHOLD = 0.8;
export const GEOCODED_CONFIDENCE = 0.85;
export const NAME_BASED_PHOTO_CONFIDENCE_THRESHOLD = 0.8;
export const MAX_NAME_BASED_PHOTOS = 4;
const GOOGLE_FIND_PLACE_ENDPOINT = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const GOOGLE_PLACE_DETAILS_ENDPOINT = "https://maps.googleapis.com/maps/api/place/details/json";

function createCacheKey(params: GenerateItineraryInput): string {
  const normalized = JSON.stringify(params);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${CACHE_PREFIX}:${hash}`;
}

type ItineraryServiceDeps = {
  llm: LLMClient;
  maps: MapsClient;
};

type BudgetAccumulator = {
  total: number;
  accommodation: number;
  transport: number;
  food: number;
  activities: number;
  other: number;
};

function computeBudgetFromActivities(dailyPlan: Itinerary["daily_plan"]): BudgetAccumulator {
  const totals: BudgetAccumulator = {
    total: 0,
    accommodation: 0,
    transport: 0,
    food: 0,
    activities: 0,
    other: 0
  };

  for (const day of dailyPlan) {
    for (const activity of day.activities) {
      if (activity.cost_estimate == null) {
        continue;
      }

      const numericCost = Number(activity.cost_estimate);

      if (!Number.isFinite(numericCost) || numericCost < 0) {
        continue;
      }

      totals.total += numericCost;

      switch (activity.kind) {
        case "hotel":
          totals.accommodation += numericCost;
          break;
        case "transport":
          totals.transport += numericCost;
          break;
        case "food":
          totals.food += numericCost;
          break;
        case "sight":
          totals.activities += numericCost;
          break;
        default:
          totals.other += numericCost;
          break;
      }
    }
  }

  return totals;
}

function mergeBudgetBreakdown(itinerary: Itinerary, totals: BudgetAccumulator): BudgetBreakdown {
  const baseBreakdown = itinerary.budget_breakdown ?? { currency: "CNY", total: 0 };

  return {
    ...baseBreakdown,
    currency: baseBreakdown.currency ?? "CNY",
    total: totals.total,
    accommodation: totals.accommodation,
    transport: totals.transport,
    food: totals.food,
    activities: totals.activities,
    other: totals.other
  };
}

type Activity = Itinerary["daily_plan"][number]["activities"][number];

type RefinementContext = {
  destination: string;
  dayLabel: string;
  originalActivities: Activity[];
  enrichedActivities: Activity[];
};

function clampConfidence(value: number | undefined, fallback: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(candidate, 0), 1);
}

function appendNote(base: string | undefined, addition: string): string {
  if (!addition) {
    return base ?? "";
  }

  if (!base) {
    return addition;
  }

  return base.includes(addition) ? base : `${base}（${addition}）`;
}

function containsHanCharacters(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }

  return /[\p{Script=Han}]/u.test(value);
}

function hasValidCoordinates(activity: Activity): boolean {
  return (
    typeof activity.lat === "number" &&
    Number.isFinite(activity.lat) &&
    typeof activity.lng === "number" &&
    Number.isFinite(activity.lng)
  );
}

function needsLocationRefinement(activity: Activity): boolean {
  const confidence = typeof activity.maps_confidence === "number" ? activity.maps_confidence : undefined;

  if (!hasValidCoordinates(activity)) {
    return true;
  }

  if (confidence == null) {
    return true;
  }

  return confidence < LLM_LOCATION_CONFIDENCE_THRESHOLD;
}

function toRefinementPreviousActivities(activities: Activity[]): Array<{ title: string; address?: string }> {
  return activities.slice(-3).map((entry) => ({
    title: entry.title,
    address: entry.address
  }));
}

function hasMeaningfulSearchTerms(result: LocationRefinementResult | null): boolean {
  if (!result) {
    return false;
  }

  return Boolean(
    (result.searchQueries && result.searchQueries.length > 0) ||
      result.refinedName ||
      result.addressHint
  );
}

function normalizeSearchTerms(destination: string, result: LocationRefinementResult): string[] {
  const terms = new Set<string>();

  if (result.refinedName) {
    terms.add(result.refinedName);
  }

  if (result.addressHint) {
    terms.add(`${destination}${result.addressHint}`);
    terms.add(result.addressHint);
  }

  if (result.searchQueries) {
    for (const query of result.searchQueries.slice(0, 5)) {
      if (query) {
        terms.add(query);
      }
    }
  }

  return Array.from(terms).slice(0, 6);
}

function validCoordinatesFromResult(result: LocationRefinementResult | null): { lat: number; lng: number } | null {
  if (!result) {
    return null;
  }

  if (typeof result.lat !== "number" || !Number.isFinite(result.lat)) {
    return null;
  }

  if (typeof result.lng !== "number" || !Number.isFinite(result.lng)) {
    return null;
  }

  const lat = result.lat;
  const lng = result.lng;

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

function applyNearbyLandmarksNote(note: string | undefined, result: LocationRefinementResult | null): string | undefined {
  if (!result || !result.nearbyLandmarks || result.nearbyLandmarks.length === 0) {
    return note;
  }

  const landmarkText = `附近参考: ${result.nearbyLandmarks.join("，")}`;
  return appendNote(note, landmarkText);
}

function applyReasonNote(note: string | undefined, result: LocationRefinementResult | null): string | undefined {
  if (!result || !result.reason) {
    return note;
  }

  return appendNote(note, result.reason);
}

async function geocodeWithCandidateTerms(
  maps: MapsClient,
  destination: string,
  activityTitle: string,
  terms: string[]
) {
  for (const term of terms) {
    try {
      const place = await maps.geocode(term, destination, {
        referenceName: activityTitle,
        minConfidence: 0.2
      });

      if (
        place &&
        typeof place.lat === "number" &&
        Number.isFinite(place.lat) &&
        typeof place.lng === "number" &&
        Number.isFinite(place.lng)
      ) {
        return place;
      }
    } catch {
      // Continue to try the next candidate term.
    }
  }

  return null;
}

export class ItineraryService {
  private readonly llm: LLMClient;
  private readonly maps: MapsClient;
  private readonly redis?: Redis;
  private readonly cacheTtl: number;
  private readonly googleMapsApiKey?: string;
  private readonly googleDispatcher?: Dispatcher | null;
  private readonly destinationInternationalCache: Map<string, boolean>;
  private readonly destinationClassifierProvider: "openai" | "qwen" | null;
  private readonly openAiApiKey?: string;
  private readonly dashscopeApiKey?: string;

  constructor({ llm, maps }: ItineraryServiceDeps) {
    this.llm = llm;
    this.maps = maps;

    const env = loadEnv();

    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL);
    }

    this.cacheTtl = DEFAULT_CACHE_TTL_SECONDS;
    this.googleMapsApiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? undefined;
    this.googleDispatcher = getGoogleMapsDispatcher();
    this.destinationInternationalCache = new Map();

    const provider = (env.AI_PROVIDER ?? "qwen").toLowerCase();
    const hasOpenAi = typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0;
    const hasDashscope = typeof env.ALIYUN_DASHSCOPE_API_KEY === "string" && env.ALIYUN_DASHSCOPE_API_KEY.trim().length > 0;

    if (provider === "openai" && hasOpenAi) {
      this.destinationClassifierProvider = "openai";
    } else if (hasDashscope) {
      this.destinationClassifierProvider = "qwen";
    } else if (hasOpenAi) {
      this.destinationClassifierProvider = "openai";
    } else {
      this.destinationClassifierProvider = null;
    }

    this.openAiApiKey = hasOpenAi ? env.OPENAI_API_KEY : undefined;
    this.dashscopeApiKey = hasDashscope ? env.ALIYUN_DASHSCOPE_API_KEY : undefined;
  }

  private async populatePlaceIdsWithGoogle(destination: string, activities: Activity[]): Promise<Activity[]> {
    if (!this.googleMapsApiKey) {
      return activities;
    }

    const results: Activity[] = [];

    for (const activity of activities) {
      const address = activity.address?.trim();
      let placeId = typeof activity.place_id === "string" ? activity.place_id.trim() : "";
      let placeDetails = activity.place_details;
      let nextActivity = activity;

      try {
        if (!placeId && address) {
          const match = await this.findPlaceIdByAddress({
            destination,
            activity,
            address
          });

          if (match?.placeId) {
            placeId = match.placeId;
          }
        }

        if (placeId && (!placeDetails || !placeDetails.formatted_address)) {
          const details = await this.fetchPlaceDetails(placeId, {
            destination,
            address
          });

          if (details) {
            if (details.payload) {
              placeDetails = { ...(placeDetails ?? {}), ...details.payload };
            }

            if (details.address && (!activity.address || activity.address.trim().length === 0)) {
              nextActivity = { ...nextActivity, address: details.address };
            }

            if (details.location) {
              nextActivity = {
                ...nextActivity,
                lat: details.location.lat,
                lng: details.location.lng
              };
            }
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ItineraryService] place enrichment failed", {
            title: activity.title,
            placeId,
            error
          });
        }
      }

      if (placeId && placeId !== activity.place_id) {
        nextActivity = { ...nextActivity, place_id: placeId };
      }

      if (placeDetails) {
        nextActivity = { ...nextActivity, place_details: placeDetails };
      }

      results.push(nextActivity);
    }

    return results;
  }

  private async findPlaceIdByAddress(params: {
    destination: string;
    activity: Activity;
    address: string;
  }): Promise<{ placeId?: string } | null> {
    const { destination, activity, address } = params;

    if (!this.googleMapsApiKey) {
      return null;
    }

    const language = containsHanCharacters(address ?? destination) ? "zh-CN" : "en";
    const query = address.slice(0, 240);

    const url = new URL(GOOGLE_FIND_PLACE_ENDPOINT);
    url.searchParams.set("input", query);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "place_id");
    url.searchParams.set("language", language);
    url.searchParams.set("key", this.googleMapsApiKey);

    if (activity.lat != null && activity.lng != null && Number.isFinite(activity.lat) && Number.isFinite(activity.lng)) {
      url.searchParams.set("locationbias", `point:${activity.lat},${activity.lng}`);
    }

    const fetchInit: RequestInit & { dispatcher?: Dispatcher } = {
      cache: "no-store"
    };

    if (this.googleDispatcher) {
      fetchInit.dispatcher = this.googleDispatcher;
    }

    const response = await fetch(url.toString(), fetchInit);

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      status?: string;
      candidates?: Array<{ place_id?: string }>;
    };

    if (!payload || payload.status !== "OK" || !payload.candidates?.length) {
      return null;
    }

    const candidate = payload.candidates.find((item) => typeof item.place_id === "string" && item.place_id.trim().length > 0);

    if (!candidate?.place_id) {
      return null;
    }

    return { placeId: candidate.place_id };
  }

  private async fetchPlaceDetails(
    placeId: string,
    context: { destination: string; address?: string | null }
  ): Promise<{
    payload?: NonNullable<Activity["place_details"]>;
    location?: { lat: number; lng: number };
    address?: string;
    name?: string;
  } | null> {
    if (!this.googleMapsApiKey) {
      return null;
    }

    const language = containsHanCharacters(context.address ?? context.destination) ? "zh-CN" : "en";

    const url = new URL(GOOGLE_PLACE_DETAILS_ENDPOINT);
    url.searchParams.set("place_id", placeId);
    url.searchParams.set(
      "fields",
      [
        "name",
        "formatted_address",
        "international_phone_number",
        "website",
        "url",
        "rating",
        "user_ratings_total",
        "types",
        "opening_hours/weekday_text",
        "geometry/location"
      ].join(",")
    );
    url.searchParams.set("language", language);
    url.searchParams.set("key", this.googleMapsApiKey);

    const fetchInit: RequestInit & { dispatcher?: Dispatcher } = {
      cache: "no-store"
    };

    if (this.googleDispatcher) {
      fetchInit.dispatcher = this.googleDispatcher;
    }

    const response = await fetch(url.toString(), fetchInit);

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      status?: string;
      result?: {
        name?: string;
        formatted_address?: string;
        international_phone_number?: string;
        website?: string;
        url?: string;
        rating?: number;
        user_ratings_total?: number;
        types?: unknown;
        opening_hours?: { weekday_text?: unknown };
        geometry?: { location?: { lat?: number; lng?: number } };
      };
    };

    if (!payload || payload.status !== "OK" || !payload.result) {
      return null;
    }

    const { result } = payload;
    const details: NonNullable<Activity["place_details"]> = {};

    if (typeof result.name === "string" && result.name.trim().length > 0) {
      details.name = result.name.trim();
    }

    if (typeof result.formatted_address === "string" && result.formatted_address.trim().length > 0) {
      details.formatted_address = result.formatted_address.trim();
    }

    if (
      typeof result.international_phone_number === "string" &&
      result.international_phone_number.trim().length > 0
    ) {
      details.international_phone_number = result.international_phone_number.trim();
    }

    if (typeof result.website === "string" && /^https?:\/\//i.test(result.website)) {
      details.website = result.website;
    }

    if (typeof result.url === "string" && /^https?:\/\//i.test(result.url)) {
      details.google_maps_uri = result.url;
    }

    if (typeof result.rating === "number" && Number.isFinite(result.rating)) {
      const bounded = Math.max(0, Math.min(5, result.rating));
      details.rating = bounded;
    }

    if (
      typeof result.user_ratings_total === "number" &&
      Number.isFinite(result.user_ratings_total) &&
      result.user_ratings_total >= 0
    ) {
      details.user_ratings_total = Math.floor(result.user_ratings_total);
    }

    if (Array.isArray(result.types)) {
      const types = result.types.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

      if (types.length > 0) {
        details.types = Array.from(new Set(types));
      }
    }

    if (result.opening_hours && Array.isArray(result.opening_hours.weekday_text)) {
      const weekdayText = result.opening_hours.weekday_text.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      );

      if (weekdayText.length > 0) {
        details.opening_hours = { weekday_text: weekdayText };
      }
    }

    const locationPayload = result.geometry?.location;
    const location =
      locationPayload &&
      typeof locationPayload.lat === "number" &&
      Number.isFinite(locationPayload.lat) &&
      typeof locationPayload.lng === "number" &&
      Number.isFinite(locationPayload.lng)
        ? { lat: locationPayload.lat, lng: locationPayload.lng }
        : undefined;

    const hasDetails = Object.keys(details).length > 0;

    if (!hasDetails && !location) {
      return null;
    }

    return {
      payload: hasDetails ? details : undefined,
      location,
      address: details.formatted_address,
      name: details.name
    };
  }

  async generate(params: GenerateItineraryInput): Promise<Itinerary> {
    const cacheKey = createCacheKey(params);

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);

        if (cached) {
          const parsed = JSON.parse(cached);
          return itinerarySchema.parse(parsed);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ItineraryService] Failed to read cache", error);
        }
      }
    }

    const generated = await this.llm.generateItinerary(params);
    const validated = itinerarySchema.parse(generated);

    const enrichedDailyPlan: Itinerary["daily_plan"] = [];
    const isInternationalDestination = await this.resolveDestinationInternationalStatus(validated.destination);

    for (const day of validated.daily_plan) {
      try {
        const enrichedActivities = await this.maps.enrichActivities(validated.destination, day.activities);
        const refinedActivities = await this.refineLowConfidenceActivities({
          destination: validated.destination,
          dayLabel: day.day,
          originalActivities: day.activities,
          enrichedActivities
        });
        let activitiesWithPlaceIds = refinedActivities;

        try {
          activitiesWithPlaceIds = await this.populatePlaceIdsWithGoogle(
            validated.destination,
            refinedActivities
          );
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[ItineraryService] Failed to populate place IDs", error);
          }
        }

        const activitiesWithMediaRequests = this.prepareMediaRequests(
          validated.destination,
          activitiesWithPlaceIds,
          isInternationalDestination
        );
        enrichedDailyPlan.push({ ...day, activities: activitiesWithMediaRequests });
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ItineraryService] Activity enrichment failed", error);
        }

        enrichedDailyPlan.push(day);
      }
    }

    const budgetTotals = computeBudgetFromActivities(enrichedDailyPlan);
    const nextBudgetBreakdown = mergeBudgetBreakdown(validated, budgetTotals);

    const finalItinerary: Itinerary = {
      ...validated,
      daily_plan: enrichedDailyPlan,
      budget_estimate: budgetTotals.total,
      budget_breakdown: nextBudgetBreakdown
    };

    if (this.redis) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(finalItinerary), "EX", this.cacheTtl);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ItineraryService] Failed to write cache", error);
        }
      }
    }

    return finalItinerary;
  }

  private async refineLowConfidenceActivities(context: RefinementContext): Promise<Activity[]> {
    const refined: Activity[] = [];

    for (let index = 0; index < context.enrichedActivities.length; index += 1) {
      const activity = context.enrichedActivities[index];
      const original = context.originalActivities[index] ?? activity;

      if (!needsLocationRefinement(activity)) {
        refined.push(activity);
        continue;
      }

      let currentActivity = activity;

      try {
        const result = await this.llm.refineActivityLocation({
          destination: context.destination,
          activityTitle: activity.title,
          kind: activity.kind,
          timeSlot: original.time_slot ?? activity.time_slot,
          existingAddress: activity.address ?? original.address,
          existingNote: activity.note ?? original.note,
          dayLabel: context.dayLabel,
          previousActivities: toRefinementPreviousActivities(refined)
        });

        currentActivity = await this.applyRefinementResult({
          destination: context.destination,
          activity,
          result
        });
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ItineraryService] LLM location refinement failed", error);
        }
      }

      refined.push(currentActivity);
    }

    return refined;
  }

  private async applyRefinementResult(params: {
    destination: string;
    activity: Activity;
    result: LocationRefinementResult | null;
  }): Promise<Activity> {
    const { destination, activity, result } = params;

    if (!result) {
      return activity;
    }

    const coordinates = validCoordinatesFromResult(result);

    if (coordinates) {
      let note: string | undefined = appendNote(activity.note, AI_LOCATION_NOTE);
      note = applyNearbyLandmarksNote(note, result);
      note = applyReasonNote(note, result);

      return {
        ...activity,
        lat: coordinates.lat,
        lng: coordinates.lng,
        address: result.addressHint ?? activity.address,
        note,
        maps_confidence: clampConfidence(result.confidence, LLM_LOCATION_MIN_CONFIDENCE),
        place_id: result.placeId ?? activity.place_id
      };
    }

    if (result && hasMeaningfulSearchTerms(result)) {
      const terms = normalizeSearchTerms(destination, result);
      const place = await geocodeWithCandidateTerms(this.maps, destination, activity.title, terms);

      if (place) {
        let note: string | undefined = appendNote(activity.note, AI_LOCATION_NOTE);
        note = applyNearbyLandmarksNote(note, result);
        note = applyReasonNote(note, result);

        return {
          ...activity,
          lat: place.lat ?? activity.lat,
          lng: place.lng ?? activity.lng,
          address: place.address ?? result.addressHint ?? activity.address,
          note,
          maps_confidence: clampConfidence(place.confidence, LLM_LOCATION_MIN_CONFIDENCE),
          place_id: place.placeId ?? result.placeId ?? activity.place_id
        };
      }
    }

    let note: string | undefined = applyNearbyLandmarksNote(activity.note, result);
    note = applyReasonNote(note, result);

    if (note === activity.note && (!result.addressHint || result.addressHint === activity.address)) {
      return activity;
    }

    return {
      ...activity,
      address: activity.address ?? result.addressHint,
      note
    };
  }

  private prepareMediaRequests(destination: string, activities: Activity[], isInternationalDestination: boolean): Activity[] {
    if (!this.googleMapsApiKey) {
      return activities.map((activity) => {
        if (activity.media_requests) {
          const { media_requests: _omit, ...withoutRequests } = activity;
          return withoutRequests;
        }
        return activity;
      });
    }

    return activities.map((activity) => {
      const next: Activity = { ...activity };
  const requests: NonNullable<Activity["media_requests"]> = {};

      const existingPhotos = Array.isArray(activity.photos) ? activity.photos : [];
      const confidence =
        typeof activity.maps_confidence === "number" && Number.isFinite(activity.maps_confidence)
          ? activity.maps_confidence
          : 0;
      const coordinate = hasValidCoordinates(activity)
        ? { lat: activity.lat as number, lng: activity.lng as number }
        : null;

      if (
        confidence >= STREET_VIEW_CONFIDENCE_THRESHOLD &&
        (coordinate || isInternationalDestination)
      ) {
        const isForeignCoordinate = coordinate ? !isCoordinateInChina(coordinate) : true;
  const addressCandidates = coordinate ? [] : this.collectAddressCandidates(activity);

        if ((coordinate && isForeignCoordinate) || (!coordinate && addressCandidates.length > 0)) {
          requests.streetView = {
            lat: coordinate?.lat,
            lng: coordinate?.lng,
            addressCandidates: addressCandidates.length > 0 ? addressCandidates : undefined,
            minConfidence: confidence
          };
        }
      }

      if (
        this.shouldSearchPhotosByName(destination, activity, isInternationalDestination) &&
        existingPhotos.length < MAX_NAME_BASED_PHOTOS
      ) {
        requests.placePhotos = {
          query: activity.title.trim(),
          destination,
          language: this.preferredGoogleLanguage(destination),
          maxResults: MAX_NAME_BASED_PHOTOS,
          placeId: activity.place_id
        };
      }

      if (requests.streetView || requests.placePhotos) {
        next.media_requests = requests;
      } else if (next.media_requests) {
        delete next.media_requests;
      }

      return next;
    });
  }

  private collectAddressCandidates(activity: Activity): string[] {
    const aggregated: string[] = [];
    const seen = new Set<string>();

    const addCandidate = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) {
        return;
      }
      if (seen.has(trimmed)) {
        return;
      }
      seen.add(trimmed);
      aggregated.push(trimmed);
    };

    const addressList = generateAddressCandidates(activity.address);
    for (const candidate of addressList) {
      addCandidate(candidate);
    }

    const noteAddress = this.extractAddressFromNote(activity.note);
    if (noteAddress) {
      const noteCandidates = generateAddressCandidates(noteAddress);
      for (const candidate of noteCandidates) {
        addCandidate(candidate);
      }
    }

    return aggregated.slice(0, 10);
  }

  private shouldSearchPhotosByName(destination: string, activity: Activity, isInternationalDestination: boolean): boolean {
    if (!activity.title || activity.title.trim().length === 0) {
      return false;
    }

    if (Array.isArray(activity.photos) && activity.photos.length > 0) {
      return false;
    }

    if (hasValidCoordinates(activity)) {
      return false;
    }

    if (activity.address && activity.address.trim().length > 0) {
      return false;
    }

    const confidence =
      typeof activity.maps_confidence === "number" && Number.isFinite(activity.maps_confidence)
        ? activity.maps_confidence
        : 0;

    if (confidence < NAME_BASED_PHOTO_CONFIDENCE_THRESHOLD) {
      return false;
    }

    return isInternationalDestination || !containsHanCharacters(activity.title);
  }

  private heuristicIsInternational(destination: string): boolean {
    if (!destination) {
      return false;
    }

    const normalized = destination.trim().toLowerCase();

    const domesticKeywords = [
      "china",
      "people's republic",
      "prc",
      "hong kong",
      "hongkong",
      "macau",
      "macao",
      "taiwan",
      "taipei",
      "shanghai",
      "beijing",
      "guangzhou",
      "shenzhen",
      "chengdu",
      "chongqing"
    ];

    for (const keyword of domesticKeywords) {
      if (normalized.includes(keyword)) {
        return false;
      }
    }

    if (/中国|內地|内地|大陆|北京|上海|广州|深圳|成都|重庆|香港|澳门|台北|台湾/.test(destination)) {
      return false;
    }

    const foreignKeywordGroups: string[][] = [
      ["japan", "tokyo", "osaka", "kyoto", "日本", "东京", "大阪", "京都"],
      ["korea", "seoul", "韩国", "首尔"],
      ["united states", "usa", "america", "los angeles", "new york", "san francisco", "美国", "纽约", "洛杉矶", "旧金山"],
      ["canada", "vancouver", "toronto", "加拿大", "温哥华", "多伦多"],
      ["australia", "sydney", "melbourne", "澳大利亚", "悉尼", "墨尔本"],
      ["united kingdom", "uk", "london", "英国", "伦敦"],
      ["france", "paris", "法国", "巴黎"],
      ["germany", "berlin", "munich", "德国", "柏林", "慕尼黑"],
      ["italy", "rome", "milan", "italia", "意大利", "罗马", "米兰"],
      ["spain", "barcelona", "madrid", "西班牙", "巴塞罗那", "马德里"],
      ["switzerland", "zurich", "瑞士", "苏黎世"],
      ["thailand", "bangkok", "泰国", "曼谷"],
      ["singapore", "新加坡"],
      ["malaysia", "kuala lumpur", "马来西亚", "吉隆坡"],
      ["vietnam", "hanoi", "ho chi minh", "越南", "河内", "胡志明"],
      ["indonesia", "bali", "jakarta", "印尼", "巴厘", "雅加达"],
      ["philippines", "manila", "菲律宾", "马尼拉"],
      ["new zealand", "auckland", "新西兰", "奥克兰"],
      ["uae", "dubai", "阿联酋", "迪拜"],
      ["egypt", "cairo", "埃及", "开罗"],
      ["south africa", "cape town", "南非", "开普敦"],
      ["brazil", "rio", "sao paulo", "巴西", "里约", "圣保罗"],
      ["mexico", "mexico city", "墨西哥", "墨西哥城"],
      ["turkey", "istanbul", "土耳其", "伊斯坦布尔"]
    ];

    for (const group of foreignKeywordGroups) {
      for (const keyword of group) {
        if (keyword.match(/^[\u4e00-\u9fa5]+$/)) {
          if (destination.includes(keyword)) {
            return true;
          }
        } else if (normalized.includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  }

  private async resolveDestinationInternationalStatus(destination: string): Promise<boolean> {
    const normalized = destination.trim().toLowerCase();

    if (!normalized) {
      return false;
    }

    if (this.destinationInternationalCache.has(normalized)) {
      return this.destinationInternationalCache.get(normalized)!;
    }

    const heuristic = this.heuristicIsInternational(destination);
    let viaLlm: boolean | null = null;

    try {
      viaLlm = await this.classifyDestinationWithLLM(destination);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ItineraryService] Destination LLM classification failed", {
          destination,
          error
        });
      }
    }

    const result = viaLlm ?? heuristic;
    this.destinationInternationalCache.set(normalized, result);
    return result;
  }

  private async classifyDestinationWithLLM(destination: string): Promise<boolean | null> {
    if (!this.destinationClassifierProvider) {
      return null;
    }

    if (this.destinationClassifierProvider === "openai" && this.openAiApiKey) {
      return this.classifyDestinationWithOpenAI(destination);
    }

    if (this.destinationClassifierProvider === "qwen" && this.dashscopeApiKey) {
      return this.classifyDestinationWithQwen(destination);
    }

    return null;
  }

  private async classifyDestinationWithOpenAI(destination: string): Promise<boolean | null> {
    if (!this.openAiApiKey) {
      return null;
    }

    const systemPrompt =
      "You decide if a travel destination is outside of Greater China. Return JSON {\"international\": true|false}. Treat mainland China, Hong Kong, Macau, and Taiwan as domestic (international=false).";
    const userPrompt = `Destination: "${destination}"`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openAiApiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    try {
      const parsed = typeof content === "string" ? JSON.parse(content) : content;
      if (typeof parsed?.international === "boolean") {
        return parsed.international;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async classifyDestinationWithQwen(destination: string): Promise<boolean | null> {
    if (!this.dashscopeApiKey) {
      return null;
    }

    const systemPrompt =
      "你需要判断一个目的地是否位于大中华地区（中国大陆、香港、澳门、台湾）。如果在该范围内，返回 JSON {\"international\": false}，否则返回 {\"international\": true}。只返回 JSON。";
    const userPrompt = `目的地：${destination}`;

    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.dashscopeApiKey}`
      },
      body: JSON.stringify({
        model: "qwen3-max",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    try {
      const parsed = typeof content === "string" ? JSON.parse(content) : content;
      if (typeof parsed?.international === "boolean") {
        return parsed.international;
      }
    } catch {
      return null;
    }

    return null;
  }

  private preferredGoogleLanguage(destination: string): string {
    return containsHanCharacters(destination) ? "zh-CN" : "en";
  }

  private extractAddressFromNote(note?: string | null): string | null {
    if (!note) {
      return null;
    }

    const match = note.match(/([\p{Script=Han}\w\s、，。·\-（）()]+\d+[号弄]?)/u);
    return match ? match[0] : null;
  }
}
