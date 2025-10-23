import { loadEnv } from "../../core/config/env";
import type { GenerateItineraryInput, LLMClient } from "../../core/ports/llm";
import { itinerarySchema } from "../../core/validation/itinerarySchema";
import { itinerarySystemPrompt, itineraryUserPrompt } from "../../core/prompts/itineraryPrompt";

const DASH_SCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

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

  const breakdown = clone.budget_breakdown;
  if (breakdown && typeof breakdown === "object") {
    const breakdownClone: Record<string, unknown> = { ...(breakdown as Record<string, unknown>) };

    if (breakdownClone.currency && typeof breakdownClone.currency !== "string") {
      breakdownClone.currency = String(breakdownClone.currency);
    }

    const costKeys = ["total", "accommodation", "transport", "food", "activities", "other"] as const;
    costKeys.forEach((key) => {
      const value = breakdownClone[key];
      if (value != null) {
        const numeric = Number(value);
        breakdownClone[key] = Number.isFinite(numeric) ? numeric : undefined;
      }
    });

    clone.budget_breakdown = breakdownClone;
  }

  return clone;
}

export class QwenClient implements LLMClient {
  async generateItinerary(params: GenerateItineraryInput) {
    const env = loadEnv();
    const apiKey = params.userApiKey ?? env.ALIYUN_DASHSCOPE_API_KEY;

    if (!apiKey) {
      throw new Error("DashScope API key is required for Qwen client.");
    }

    const response = await fetch(DASH_SCOPE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "qwen3-max",
        temperature: 0.25,
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
      throw new Error(`Qwen request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Qwen response missing content");
    }

    let parsed: unknown;

    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch (error) {
      throw new Error("Qwen returned invalid JSON");
    }

    const normalized = normalizeItineraryPayload(parsed);

    return itinerarySchema.parse(normalized);
  }
}
