import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, getSupabaseServiceRoleClient } from "../../../lib/supabase/server";
import { TripService } from "../../../services/TripService";

const tripRequestSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  destination: z.string().min(1),
  startDate: z.string().min(4),
  endDate: z.string().min(4),
  partySize: z.number().int().positive().optional(),
  preferences: z.array(z.string()).optional(),
  budget: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(1).optional(),
  notes: z.string().nullable().optional()
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
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
    const input = listQuerySchema.parse(searchParams);
    const service = new TripService({ supabase, userId });
    const result = await service.listTrips({ page: input.page, pageSize: input.pageSize });
    return jsonOk(result);
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

  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const payload = tripRequestSchema.parse(body);
    const service = new TripService({ supabase, userId });

    if (payload.id) {
      const updated = await service.updateTrip({
        id: payload.id,
        title: payload.title,
        destination: payload.destination,
        startDate: payload.startDate,
        endDate: payload.endDate,
        partySize: payload.partySize,
        preferences: payload.preferences,
        budget: payload.budget ?? undefined,
        currency: payload.currency,
        notes: payload.notes
      });

      return jsonOk(updated, { status: 200 });
    }

    const created = await service.createTrip({
      title: payload.title,
      destination: payload.destination,
      startDate: payload.startDate,
      endDate: payload.endDate,
      partySize: payload.partySize,
      preferences: payload.preferences,
      budget: payload.budget ?? undefined,
      currency: payload.currency,
      notes: payload.notes
    });

    return jsonOk(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(error.errors.map((issue) => issue.message).join(", "), 400);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserIdFromRequest(req);
    const supabase = getSupabaseServiceRoleClient();
    const { searchParams } = req.nextUrl;
    const tripId = searchParams.get("id");

    if (!tripId) {
      return jsonFail("Trip id is required", 400);
    }

    const service = new TripService({ supabase, userId });
    await service.deleteTrip(tripId);
    return jsonOk({ id: tripId }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}
