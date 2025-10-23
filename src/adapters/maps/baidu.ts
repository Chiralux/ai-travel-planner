import { loadEnv } from "../../core/config/env";
import type { MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const BAIDU_SUGGESTION_ENDPOINT = "https://api.map.baidu.com/place/v2/suggestion";

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

  async geocode(name: string, cityOrDestination?: string): Promise<Place | null> {
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

      const suggestion = response.result[0];
      const lat = suggestion.location?.lat;
      const lng = suggestion.location?.lng;

      return {
        name: suggestion.name ?? query,
        address: suggestion.address || suggestion.district,
        city: suggestion.city,
        lat: typeof lat === "number" ? lat : undefined,
        lng: typeof lng === "number" ? lng : undefined,
        provider: "baidu",
        raw: suggestion
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
        const place = await this.geocode(activity.title, destination);

        if (place) {
          enriched.push({
            ...activity,
            lat: activity.lat ?? place.lat,
            lng: activity.lng ?? place.lng,
            address: activity.address ?? place.address
          });
          continue;
        }
      } catch {
        /* noop to allow soft failure */
      }

      enriched.push(activity);
    }

    return enriched;
  }
}
