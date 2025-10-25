import type {
  GenerateItineraryInput,
  LLMClient,
  LocationRefinementInput,
  LocationRefinementResult
} from "../../core/ports/llm";
import { loadEnv } from "../../core/config/env";
import { itinerarySchema } from "../../core/validation/itinerarySchema";
import { itinerarySystemPrompt, itineraryUserPrompt } from "../../core/prompts/itineraryPrompt";
import {
  locationRefinementSystemPrompt,
  locationRefinementUserPrompt
} from "../../core/prompts/locationRefinementPrompt";

function normalizeItineraryPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const clone: Record<string, unknown> = { ...(payload as Record<string, unknown>) };

  if (Array.isArray(clone.tips)) {
    clone.tips = clone.tips.map(String).join("\n");
  }

  if (clone.daily_plan && Array.isArray(clone.daily_plan)) {
    clone.daily_plan = clone.daily_plan.map((day) => {
      if (!day || typeof day !== "object") {
        return day;
      }

      const dayClone: Record<string, unknown> = { ...(day as Record<string, unknown>) };

      if (!Array.isArray(dayClone.activities)) {
        dayClone.activities = [];
      }

      return dayClone;
    });
  }

  return clone;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export class OpenAIClient implements LLMClient {
  async generateItinerary(params: GenerateItineraryInput) {
    const env = loadEnv();
    const apiKey = params.userApiKey ?? env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }

    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: itinerarySystemPrompt
          },
          {
            role: "user",
            content: itineraryUserPrompt(params)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI response missing content");
    }

    let parsed: unknown;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch (error) {
      throw new Error("OpenAI returned invalid JSON");
    }

    const normalized = normalizeItineraryPayload(parsed);

    return itinerarySchema.parse(normalized);
  }

  async refineActivityLocation(input: LocationRefinementInput): Promise<LocationRefinementResult | null> {
    const env = loadEnv();
    const apiKey = env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }

    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: locationRefinementSystemPrompt
          },
          {
            role: "user",
            content: locationRefinementUserPrompt({
              destination: input.destination,
              activityTitle: input.activityTitle,
              kind: input.kind,
              timeSlot: input.timeSlot,
              existingAddress: input.existingAddress,
              existingNote: input.existingNote,
              dayLabel: input.dayLabel,
              previousActivities: input.previousActivities?.slice(-3)
            })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return null;
    }

    return normalizeLocationRefinementPayload(parsed);
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const source = Array.isArray(value) ? value : [value];
  const normalized = source
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));

  return normalized.length > 0 ? normalized.slice(0, 5) : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9+\-\.]/g, "");
    if (!normalized) {
      return undefined;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
}

function normalizeLocationRefinementPayload(payload: unknown): LocationRefinementResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;

  const latSource = data.latitude ?? data.lat;
  const lngSource = data.longitude ?? data.lng;

  const lat = coerceNumber(latSource);
  const lng = coerceNumber(lngSource);
  const confidence = coerceNumber(data.confidence);

  const refinedName = normalizeString(data.refined_name ?? data.refinedName);
  const addressHint = normalizeString(data.address_hint ?? data.addressHint);
  const searchQueries = normalizeStringArray(data.search_queries ?? data.searchQueries);
  const nearbyLandmarks = normalizeStringArray(data.nearby_landmarks ?? data.nearbyLandmarks);
  const reason = normalizeString(data.reason);

  const result: LocationRefinementResult = {};

  if (refinedName) {
    result.refinedName = refinedName;
  }

  if (addressHint) {
    result.addressHint = addressHint;
  }

  if (searchQueries) {
    result.searchQueries = searchQueries;
  }

  if (nearbyLandmarks) {
    result.nearbyLandmarks = nearbyLandmarks;
  }

  if (typeof lat === "number" && typeof lng === "number") {
    result.lat = lat;
    result.lng = lng;
  }

  if (typeof confidence === "number") {
    result.confidence = confidence;
  }

  if (reason) {
    result.reason = reason;
  }

  return Object.keys(result).length === 0 ? null : result;
}
