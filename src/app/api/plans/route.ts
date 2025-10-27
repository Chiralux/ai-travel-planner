import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { itinerarySchema } from "../../../core/validation/itinerarySchema";
import { createSupabaseServerClient, getSupabaseServiceRoleClient } from "../../../lib/supabase/server";
import { PlanService } from "../../../services/PlanService";

const originCoordsSchema = z.object({
  lat: z.number(),
  lng: z.number()
});

const formSnapshotSchema = z.object({
  destination: z.string().default(""),
  days: z.number().int().positive(),
  budget: z.number().nonnegative().optional(),
  partySize: z.number().int().positive().optional(),
  preferences: z.array(z.string()).default([]),
  origin: z.string().optional(),
  originCoords: originCoordsSchema.optional()
});

const savePlanSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  summary: z.string().max(200).optional(),
  form: formSnapshotSchema,
  itinerary: itinerarySchema
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50)
});

async function getUserIdFromRequest(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "") ?? null;

  const supabase = createSupabaseServerClient(accessToken);
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(accessToken ?? undefined);

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

function jsonOk(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, data }, init);
}

function jsonFail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const input = listQuerySchema.safeParse(searchParams);

    if (!input.success) {
      return jsonFail("Invalid query parameters", 400);
    }

    const service = new PlanService({ supabase, userId });
    const plans = await service.listPlans();

    const start = (input.data.page - 1) * input.data.pageSize;
    const paginated = plans.slice(start, start + input.data.pageSize);

    return jsonOk({
      items: paginated,
      total: plans.length,
      page: input.data.page,
      pageSize: input.data.pageSize
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonFail("Invalid JSON body", 400);
  }

  const parsed = savePlanSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.errors.map((issue) => issue.message).join(", ");
    return jsonFail(message, 400);
  }

  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new PlanService({ supabase, userId });
    const saved = await service.savePlan(parsed.data);

    return jsonOk(
      {
        id: saved.id,
        title: saved.title,
        summary: saved.summary ?? null,
        createdAt: saved.created_at,
        updatedAt: saved.updated_at
      },
      { status: parsed.data.id ? 200 : 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}
