import { loadEnv } from "../../core/config/env";
import type { GenerateItineraryInput, LLMClient } from "../../core/ports/llm";
import { itinerarySchema } from "../../core/validation/itinerarySchema";
import { itinerarySystemPrompt, itineraryUserPrompt } from "../../core/prompts/itineraryPrompt";

const DASH_SCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[\s,]/g, "");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);

    if (!match) {
      return undefined;
    }

    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return undefined;
}

const COST_FALLBACK_BY_KIND: Record<string, number> = {
  food: 80,
  transport: 40,
  hotel: 480,
  other: 60
};

const PAID_SIGHT_KEYWORDS = [
  /博物馆/,
  /美术馆/,
  /景区/,
  /乐园/,
  /水族馆/,
  /动物园/,
  /剧院/,
  /演出/,
  /游船/,
  /观景/,
  /摩天轮/,
  /登塔/,
  /灯光秀/
];

function roundUpToNearestTen(value: number): number {
  return Math.ceil(value / 10) * 10;
}

function sanitizeCostEstimate(kindRaw: unknown, titleRaw: unknown, rawCost: unknown): number | undefined {
  const kind = typeof kindRaw === "string" ? kindRaw.toLowerCase() : undefined;
  const title = typeof titleRaw === "string" ? titleRaw : "";
  const numeric = coerceNumber(rawCost);

  if (typeof numeric === "number" && numeric > 0) {
    return roundUpToNearestTen(numeric);
  }

  if (kind === "sight") {
    const requiresTicket = PAID_SIGHT_KEYWORDS.some((pattern) => pattern.test(title));
    if (requiresTicket) {
      return COST_FALLBACK_BY_KIND.other;
    }
    return undefined;
  }

  if (kind && COST_FALLBACK_BY_KIND[kind] != null) {
    return COST_FALLBACK_BY_KIND[kind];
  }

  return undefined;
}

function normalizeItineraryPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const clone: Record<string, unknown> = { ...(payload as Record<string, unknown>) };

  if (clone.budget_estimate != null) {
    const numeric = coerceNumber(clone.budget_estimate);
    clone.budget_estimate = typeof numeric === "number" ? numeric : undefined;
  }

  if (clone.party_size != null) {
    const numeric = coerceNumber(clone.party_size);
    clone.party_size = typeof numeric === "number" ? Math.max(1, Math.round(numeric)) : undefined;
  }

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
      } else {
        dayClone.activities = dayClone.activities.map((activity) => {
          if (!activity || typeof activity !== "object") {
            return activity;
          }

          const activityClone: Record<string, unknown> = {
            ...(activity as Record<string, unknown>)
          };

          const sanitizedCost = sanitizeCostEstimate(
            activityClone.kind,
            activityClone.title,
            activityClone.cost_estimate
          );
          activityClone.cost_estimate = sanitizedCost;

          return activityClone;
        });
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
        const numeric = coerceNumber(value);
        breakdownClone[key] = typeof numeric === "number" ? numeric : undefined;
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
