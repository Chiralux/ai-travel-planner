import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, getSupabaseServiceRoleClient } from "../../../../lib/supabase/server";
import { PlanService } from "../../../../services/PlanService";
import { itinerarySchema } from "../../../../core/validation/itinerarySchema";

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

const updatePlanSchema = z.object({
  title: z.string().min(1),
  summary: z.string().max(200).optional(),
  form: formSnapshotSchema,
  itinerary: itinerarySchema
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getUserIdFromRequest(_req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new PlanService({ supabase, userId });
    const plan = await service.getPlan(params.id);

    if (!plan) {
      return jsonFail("Plan not found", 404);
    }

    return jsonOk(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonFail("Invalid JSON body", 400);
  }

  const parsed = updatePlanSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.errors.map((issue) => issue.message).join(", ");
    return jsonFail(message, 400);
  }

  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new PlanService({ supabase, userId });
    const saved = await service.savePlan({ id: params.id, ...parsed.data });

    return jsonOk({
      id: saved.id,
      title: saved.title,
      summary: saved.summary ?? null,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new PlanService({ supabase, userId });
    await service.deletePlan(params.id);
    return jsonOk({ id: params.id }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}
