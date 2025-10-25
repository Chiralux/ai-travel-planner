import { createHash } from "crypto";
import Redis from "ioredis";
import type { MapsClient } from "../core/ports/maps";
import type { LLMClient, GenerateItineraryInput } from "../core/ports/llm";
import { itinerarySchema, type BudgetBreakdown, type Itinerary } from "../core/validation/itinerarySchema";
import { loadEnv } from "../core/config/env";

const CACHE_PREFIX = "itinerary";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60; // 1 hour cache window

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

export class ItineraryService {
  private readonly llm: LLMClient;
  private readonly maps: MapsClient;
  private readonly redis?: Redis;
  private readonly cacheTtl: number;

  constructor({ llm, maps }: ItineraryServiceDeps) {
    this.llm = llm;
    this.maps = maps;

    const env = loadEnv();

    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL);
    }

    this.cacheTtl = DEFAULT_CACHE_TTL_SECONDS;
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
        const activities = await this.maps.enrichActivities(validated.destination, day.activities);
        enrichedDailyPlan.push({ ...day, activities });
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
}
