import { loadEnv } from "../../core/config/env";
import type { GenerateItineraryInput, LLMClient } from "../../core/ports/llm";
import { itinerarySchema } from "../../core/validation/itinerarySchema";
import { itinerarySystemPrompt, itineraryUserPrompt } from "../../core/prompts/itineraryPrompt";

const DASH_SCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/v1/chat/completions";

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
        model: "qwen-plus",
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

    return itinerarySchema.parse(parsed);
  }
}
