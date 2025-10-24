import { z } from "zod";
import { loadEnv } from "../core/config/env";
import { travelInputSystemPrompt, travelInputUserPrompt } from "../core/prompts/travelInputPrompt";
import { parseTravelInput as localParseTravelInput, type ParsedTravelInput } from "../core/utils/travelInputParser";

type Provider = "qwen" | "openai";

const responseSchema = z.object({
  destination: z.string().min(1).optional().nullable(),
  origin: z.string().min(1).optional().nullable(),
  days: z.number().int().positive().optional().nullable(),
  budget: z.number().int().nonnegative().optional().nullable(),
  party_size: z.number().int().positive().optional().nullable(),
  preferences: z.array(z.string().min(1)).optional().nullable(),
  notes: z.array(z.string()).optional().nullable()
});

type NormalizedLLMResult = {
  destination?: string;
  origin?: string;
  days?: number;
  budget?: number;
  partySize?: number;
  preferences?: string[];
};

function normalizeLLMResult(raw: unknown): NormalizedLLMResult {
  const parsed = responseSchema.safeParse(raw);

  if (!parsed.success) {
    return {};
  }

  const value = parsed.data;

  return {
    destination: value.destination ?? undefined,
    origin: value.origin ?? undefined,
    days: value.days ?? undefined,
    budget: value.budget ?? undefined,
    partySize: value.party_size ?? undefined,
    preferences: value.preferences?.filter((item) => item && item.trim().length > 0)
  };
}

function mergeResults(base: ParsedTravelInput | null, llmResult: NormalizedLLMResult): ParsedTravelInput | null {
  if (!base && Object.keys(llmResult).length === 0) {
    return null;
  }

  const merged: ParsedTravelInput = {
    destination: base?.destination ?? llmResult.destination,
    origin: base?.origin ?? llmResult.origin,
    days: base?.days ?? llmResult.days,
    budget: base?.budget ?? llmResult.budget,
    partySize: base?.partySize ?? llmResult.partySize,
    preferences: (() => {
      const combined = [
        ...(base?.preferences ?? []),
        ...(llmResult.preferences ?? [])
      ];
      const unique = Array.from(new Set(combined.filter(Boolean)));
      return unique.length > 0 ? unique : undefined;
    })()
  };

  if (
    !merged.destination &&
    !merged.origin &&
    !merged.days &&
    !merged.budget &&
    !merged.partySize &&
    (!merged.preferences || merged.preferences.length === 0)
  ) {
    return null;
  }

  return merged;
}

export class TravelInputParserService {
  private readonly provider: Provider;

  constructor() {
    const env = loadEnv();
    const provider = (env.AI_PROVIDER ?? "qwen").toLowerCase();
    this.provider = provider === "openai" ? "openai" : "qwen";
  }

  async parse(
    text: string,
    options: { knownPreferences?: string[] } = {}
  ): Promise<ParsedTravelInput | null> {
    const cleaned = text.trim();

    if (!cleaned) {
      return null;
    }

    const heuristic = localParseTravelInput(cleaned, options);
    const missingFields = !heuristic || [
      heuristic.destination,
      heuristic.origin,
      heuristic.days,
      heuristic.budget,
      heuristic.partySize,
      heuristic.preferences?.length
    ].some((value) => value == null || value === 0);

    if (!missingFields) {
      return heuristic;
    }

    const llmResult = await this.callLLM(cleaned, options.knownPreferences ?? [], heuristic);
    const normalized = normalizeLLMResult(llmResult);

    return mergeResults(heuristic, normalized);
  }

  private async callLLM(
    text: string,
    knownPreferences: string[],
    heuristic: ParsedTravelInput | null
  ): Promise<unknown> {
    if (this.provider === "openai") {
      return this.callOpenAI(text, knownPreferences, heuristic);
    }

    return this.callQwen(text, knownPreferences, heuristic);
  }

  private async callQwen(
    text: string,
    knownPreferences: string[],
    heuristic: ParsedTravelInput | null
  ): Promise<unknown> {
    const env = loadEnv();
    const apiKey = env.ALIYUN_DASHSCOPE_API_KEY;

    if (!apiKey) {
      throw new Error("ALIYUN_DASHSCOPE_API_KEY is required for Qwen parsing");
    }

    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "qwen3-max",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: travelInputSystemPrompt },
          { role: "user", content: travelInputUserPrompt({
            originalText: text,
            knownPreferences,
            heuristicResult: heuristic
          }) }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Qwen parse request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Qwen parse response missing content");
    }

    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch (error) {
      throw new Error("Qwen parse response is not valid JSON");
    }
  }

  private async callOpenAI(
    text: string,
    knownPreferences: string[],
    heuristic: ParsedTravelInput | null
  ): Promise<unknown> {
    const env = loadEnv();
    const apiKey = env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for parsing");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
          { role: "system", content: travelInputSystemPrompt },
          { role: "user", content: travelInputUserPrompt({
            originalText: text,
            knownPreferences,
            heuristicResult: heuristic
          }) }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI parse request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI parse response missing content");
    }

    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch (error) {
      throw new Error("OpenAI parse response is not valid JSON");
    }
  }
}
