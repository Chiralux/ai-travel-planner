import { loadEnv } from "../../core/config/env";
import type { MapsClient, Place } from "../../core/ports/maps";
import type { Activity } from "../../core/validation/itinerarySchema";
import { requestJson } from "./shared";

const AMAP_TEXT_ENDPOINT = "https://restapi.amap.com/v5/place/text";

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

  async geocode(name: string, cityOrDestination?: string): Promise<Place | null> {
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
      page_size: "1",
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

      const poi = response.pois[0];
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
        raw: poi
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

      if ((hasCoords && activity.address) || !activity.title) {
        enriched.push(activity);
        continue;
      }

      try {
        const searchTerms = this.buildSearchTerms(destination, activity.title, activity.address, activity.note);

        let place: Place | null = null;

        for (const term of searchTerms) {
          place = await this.geocode(term, destination);

          if (place) {
            break;
          }
        }

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
        /* swallow to keep soft failure */
      }

      enriched.push(activity);
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
