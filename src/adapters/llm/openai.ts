import type { GenerateItineraryInput, LLMClient } from "../../core/ports/llm";
import { loadEnv } from "../../core/config/env";
import { itinerarySchema } from "../../core/validation/itinerarySchema";
import { itinerarySystemPrompt, itineraryUserPrompt } from "../../core/prompts/itineraryPrompt";

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
}
