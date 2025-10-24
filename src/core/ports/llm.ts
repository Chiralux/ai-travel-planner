import { QwenClient } from "../../adapters/llm/qwen";
import { OpenAIClient } from "../../adapters/llm/openai";
import { loadEnv } from "../config/env";
import type { Activity, Itinerary } from "../validation/itinerarySchema";

export type GenerateItineraryInput = {
  destination: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  budget?: number;
  partySize?: number;
  preferences?: string[];
  origin?: string;
  originCoords?: {
    lat: number;
    lng: number;
  };
  specialNotes?: string;
  fallback?: Partial<Itinerary>;
  userApiKey?: string;
};

export interface LLMClient {
  generateItinerary(params: GenerateItineraryInput): Promise<Itinerary>;
}

export type LLMProvider = "qwen" | "openai";

export type LLMResponse = {
  itinerary: Itinerary;
  raw: unknown;
};

export type NormalizedActivity = Activity;

export function createLLMClient(provider?: string): LLMClient {
  const env = loadEnv();
  const selected = (provider ?? env.AI_PROVIDER ?? "qwen").toLowerCase();

  if (selected === "openai") {
    return new OpenAIClient();
  }

  return new QwenClient();
}
