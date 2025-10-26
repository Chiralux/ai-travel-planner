import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, getSupabaseServiceRoleClient } from "../../../lib/supabase/server";
import { ExpenseService } from "../../../services/ExpenseService";

const listSchema = z.object({
  tripId: z.string().uuid(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional()
});

const expenseInputSchema = z.object({
  id: z.string().uuid().optional(),
  tripId: z.string().uuid(),
  activityId: z.string().uuid().nullable().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  method: z.string().min(1).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
  recordedAt: z.string().datetime().optional()
});

async function getUserId(req: NextRequest): Promise<string> {
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
    const query = Object.fromEntries(req.nextUrl.searchParams.entries());
    const params = listSchema.parse(query);
    const userId = await getUserId(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new ExpenseService({ supabase, userId });
    const result = await service.listExpenses({
      tripId: params.tripId,
      page: params.page,
      pageSize: params.pageSize
    });

    return jsonOk(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(error.errors.map((issue) => issue.message).join(", "), 400);
    }

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
    const payload = expenseInputSchema.parse(body);
    const userId = await getUserId(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new ExpenseService({ supabase, userId });

    if (payload.id) {
      const updated = await service.updateExpense({
        id: payload.id,
        tripId: payload.tripId,
        activityId: payload.activityId,
        amount: payload.amount,
        currency: payload.currency,
        category: payload.category,
        method: payload.method,
        note: payload.note,
        recordedAt: payload.recordedAt
      });

      return jsonOk(updated);
    }

    const created = await service.createExpense({
      tripId: payload.tripId,
      activityId: payload.activityId,
      amount: payload.amount,
      currency: payload.currency,
      category: payload.category,
      method: payload.method,
      note: payload.note,
      recordedAt: payload.recordedAt
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
    const searchParams = req.nextUrl.searchParams;
    const id = searchParams.get("id");

    if (!id) {
      return jsonFail("Expense id is required", 400);
    }

    const userId = await getUserId(req);
    const supabase = getSupabaseServiceRoleClient();
    const service = new ExpenseService({ supabase, userId });

    await service.deleteExpense(id);
    return jsonOk({ id }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonFail(message, status);
  }
}
