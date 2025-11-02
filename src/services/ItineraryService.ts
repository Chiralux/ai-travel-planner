import { createHash } from "crypto";
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

const CACHE_PREFIX = "itinerary";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache window
const LLM_LOCATION_CONFIDENCE_THRESHOLD = 0.45;
const LLM_LOCATION_MIN_CONFIDENCE = 0.35;
const AI_LOCATION_NOTE = "位置信息由AI辅助推断，请注意核实。";
export const STREET_VIEW_CONFIDENCE_THRESHOLD = 0.8;
export const GEOCODED_CONFIDENCE = 0.85;
export const NAME_BASED_PHOTO_CONFIDENCE_THRESHOLD = 0.8;
export const MAX_NAME_BASED_PHOTOS = 4;

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

  constructor({ llm, maps }: ItineraryServiceDeps) {
    this.llm = llm;
    this.maps = maps;

    const env = loadEnv();

    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL);
    }

    this.cacheTtl = DEFAULT_CACHE_TTL_SECONDS;
    this.googleMapsApiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? undefined;
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

    for (const day of validated.daily_plan) {
      try {
        const enrichedActivities = await this.maps.enrichActivities(validated.destination, day.activities);
        const refinedActivities = await this.refineLowConfidenceActivities({
          destination: validated.destination,
          dayLabel: day.day,
          originalActivities: day.activities,
          enrichedActivities
        });
        const activitiesWithMediaRequests = this.prepareMediaRequests(
          validated.destination,
          refinedActivities
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
        maps_confidence: clampConfidence(result.confidence, LLM_LOCATION_MIN_CONFIDENCE)
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
          maps_confidence: clampConfidence(place.confidence, LLM_LOCATION_MIN_CONFIDENCE)
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

  private prepareMediaRequests(destination: string, activities: Activity[]): Activity[] {
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
        (coordinate || this.isLikelyInternationalDestination(destination))
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
        this.shouldSearchPhotosByName(destination, activity) &&
        existingPhotos.length < MAX_NAME_BASED_PHOTOS
      ) {
        requests.placePhotos = {
          query: activity.title.trim(),
          destination,
          language: this.preferredGoogleLanguage(destination),
          maxResults: MAX_NAME_BASED_PHOTOS
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
    const candidates = [
      activity.address,
      this.extractAddressFromNote(activity.note)
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));

    return Array.from(new Set(candidates)).slice(0, 5);
  }

  private shouldSearchPhotosByName(destination: string, activity: Activity): boolean {
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

    return this.isLikelyInternationalDestination(destination) || !containsHanCharacters(activity.title);
  }

  private isLikelyInternationalDestination(destination: string): boolean {
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

    return true;
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
