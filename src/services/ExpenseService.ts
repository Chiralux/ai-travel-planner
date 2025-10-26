import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../lib/supabase/types";

export type ExpenseListOptions = {
  tripId: string;
  page?: number;
  pageSize?: number;
};

export type ExpenseCreateInput = {
  tripId: string;
  activityId?: string | null;
  amount: number;
  currency?: string;
  category?: string;
  method?: string | null;
  note?: string | null;
  recordedAt?: string;
};

export type ExpenseUpdateInput = Partial<Omit<ExpenseCreateInput, "tripId">> & {
  id: string;
  tripId: string;
};

export type ExpenseListResult = {
  items: Tables<"expenses">[];
  page: number;
  pageSize: number;
  total: number;
};

type ExpenseServiceDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

function normalizePagination(value: number | undefined, fallback: number, min = 1, max = 100) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}

export class ExpenseService {
  private readonly supabase: SupabaseClient<Database>;
  private readonly userId: string;

  constructor({ supabase, userId }: ExpenseServiceDeps) {
    this.supabase = supabase;
    this.userId = userId;
  }

  async listExpenses(options: ExpenseListOptions): Promise<ExpenseListResult> {
    const page = normalizePagination(options.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = normalizePagination(options.pageSize, 20, 1, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await this.supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .eq("user_id", this.userId)
      .eq("trip_id", options.tripId)
      .order("recorded_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return {
      items: data ?? [],
      page,
      pageSize,
      total: count ?? data?.length ?? 0
    };
  }

  async getExpenseById(expenseId: string): Promise<Tables<"expenses"> | null> {
    const { data, error } = await this.supabase
      .from("expenses")
      .select("*")
      .eq("id", expenseId)
      .eq("user_id", this.userId)
      .maybeSingle();

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data ?? null;
  }

  async createExpense(input: ExpenseCreateInput): Promise<Tables<"expenses">> {
    const payload: Database["public"]["Tables"]["expenses"]["Insert"] = {
      trip_id: input.tripId,
      user_id: this.userId,
      activity_id: input.activityId ?? null,
      amount: input.amount,
      currency: input.currency ?? "CNY",
      category: input.category ?? "other",
      method: input.method ?? null,
      note: input.note ?? null,
      recorded_at: input.recordedAt ?? new Date().toISOString()
    };

    const { data, error } = await this.supabase
      .from("expenses")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data;
  }

  async updateExpense(input: ExpenseUpdateInput): Promise<Tables<"expenses">> {
    const payload: Database["public"]["Tables"]["expenses"]["Update"] = {
      activity_id: input.activityId ?? undefined,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      method: input.method,
      note: input.note,
      recorded_at: input.recordedAt
    };

    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(sanitizedPayload).length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No fields provided for update" });
    }

    const { data, error } = await this.supabase
      .from("expenses")
      .update(sanitizedPayload)
  .eq("id", input.id)
  .eq("trip_id", input.tripId)
      .eq("user_id", this.userId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
      }

      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data;
  }

  async deleteExpense(expenseId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("user_id", this.userId);

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }
  }
}
