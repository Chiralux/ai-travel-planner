import { AMapClient } from "../../adapters/maps/amap";
import { BaiduMapClient } from "../../adapters/maps/baidu";
import { loadEnv } from "../config/env";
import type { Activity } from "../validation/itinerarySchema";

export type MapsProvider = "amap" | "baidu";

export type Place = {
  name: string;
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
  provider: MapsProvider;
  raw?: unknown;
};

export interface MapsClient {
  geocode(name: string, cityOrDestination?: string): Promise<Place | null>;
  enrichActivities(destination: string, activities: Activity[]): Promise<Activity[]>;
}

export function createMapsClient(provider?: string): MapsClient {
  const env = loadEnv();
  const base = provider ?? env.MAPS_PROVIDER;
  const selected = (typeof base === "string" && base.trim().length > 0 ? base : "amap").toLowerCase();

  if (selected === "baidu") {
    return new BaiduMapClient();
  }

  return new AMapClient();
}
