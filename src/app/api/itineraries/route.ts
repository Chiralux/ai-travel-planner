import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { appRouter, createContext, itineraryInputSchema } from "../../../server/trpc";

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
  const input = itineraryInputSchema.parse(body);
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  const data = await caller.generateItinerary(input);

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.errors.map((issue) => issue.message).join(", ")
        },
        { status: 400 }
      );
    }

    if (error instanceof TRPCError) {
      const status = getHTTPStatusCodeFromError(error);
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
