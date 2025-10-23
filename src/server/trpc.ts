import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { loadEnv } from "../core/config/env";
import { QwenClient } from "../adapters/llm/qwen";
import { OpenAIClient } from "../adapters/llm/openai";
import { AMapClient } from "../adapters/maps/amap";
import type { GenerateItineraryInput } from "../core/ports/llm";
import { ItineraryService } from "../services/ItineraryService";

export type TrpcContext = {
  itineraryService: ItineraryService;
};

const t = initTRPC.context<TrpcContext>().create();

export const itineraryInputSchema = z.object({
  destination: z.string().min(1, "Destination is required"),
  days: z.number().int().positive("Days must be positive"),
  budget: z.number().nonnegative().optional(),
  partySize: z.number().int().positive().optional(),
  preferences: z.array(z.string().min(1)).optional()
});

function resolveLLMClient(provider: string) {
  if (provider === "openai") {
    return new OpenAIClient();
  }

  return new QwenClient();
}

export async function createContext(): Promise<TrpcContext> {
  const env = loadEnv();
  const provider = (env.AI_PROVIDER ?? "qwen").toLowerCase();

  if (!env.AMAP_REST_KEY) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AMAP_REST_KEY is required" });
  }

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "OPENAI_API_KEY is required" });
    }
  } else {
    if (!env.ALIYUN_DASHSCOPE_API_KEY) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ALIYUN_DASHSCOPE_API_KEY is required" });
    }
  }

  const llm = resolveLLMClient(provider);
  const maps = new AMapClient();
  const itineraryService = new ItineraryService({ llm, maps });

  return { itineraryService };
}

export const appRouter = t.router({
  generateItinerary: t.procedure.input(itineraryInputSchema).mutation(async ({ input, ctx }) => {
    const payload: GenerateItineraryInput = {
      destination: input.destination,
      days: input.days,
      budget: input.budget,
      partySize: input.partySize,
      preferences: input.preferences
    };

    return ctx.itineraryService.generate(payload);
  })
});

export type AppRouter = typeof appRouter;
