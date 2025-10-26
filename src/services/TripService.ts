import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../lib/supabase/types";

export type TripListOptions = {
  page?: number;
  pageSize?: number;
};

export type TripCreateInput = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  partySize?: number;
  preferences?: string[];
  budget?: number | null;
  currency?: string;
  notes?: string | null;
};

export type TripUpdateInput = TripCreateInput & {
  id: string;
};

export type TripListResult = {
  items: Tables<"trips">[];
  page: number;
  pageSize: number;
  total: number;
};

export type TripWithRelations = Tables<"trips"> & {
  trip_days: Array<
    Tables<"trip_days"> & {
      activities: Tables<"activities">[];
    }
  >;
};

type TripServiceDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

function ensurePositiveInteger(value: number | undefined, fallback: number, min = 1, max = 100) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}

export class TripService {
  private readonly supabase: SupabaseClient<Database>;
  private readonly userId: string;

  constructor({ supabase, userId }: TripServiceDeps) {
    this.supabase = supabase;
    this.userId = userId;
  }

  async listTrips(options: TripListOptions = {}): Promise<TripListResult> {
    const page = ensurePositiveInteger(options.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = ensurePositiveInteger(options.pageSize, 20, 1, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await this.supabase
      .from("trips")
      .select("*", { count: "exact" })
      .eq("user_id", this.userId)
      .order("start_date", { ascending: true })
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

  async getTripById(tripId: string): Promise<TripWithRelations | null> {
    const { data, error } = await this.supabase
      .from("trips")
      .select(
        `*,
        trip_days(
          *,
          activities(*)
        )`
      )
      .eq("id", tripId)
      .eq("user_id", this.userId)
      .maybeSingle();

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    if (!data) {
      return null;
    }

    const sortedDays = [...(data.trip_days ?? [])].sort((a, b) => a.day_index - b.day_index);
    const normalizedDays = sortedDays.map((day) => ({
      ...day,
      activities: [...(day.activities ?? [])].sort((a, b) => {
        const aStart = a.start_time ?? "";
        const bStart = b.start_time ?? "";
        return aStart.localeCompare(bStart);
      })
    }));

    return {
      ...(data as Tables<"trips">),
      trip_days: normalizedDays as TripWithRelations["trip_days"]
    };
  }

  async createTrip(input: TripCreateInput): Promise<Tables<"trips">> {
    const payload: Database["public"]["Tables"]["trips"]["Insert"] = {
      user_id: this.userId,
      title: input.title,
      destination: input.destination,
      start_date: input.startDate,
      end_date: input.endDate,
      party_size: input.partySize ?? 1,
      preferences: input.preferences ?? [],
      budget: input.budget ?? null,
      currency: input.currency ?? "CNY",
      notes: input.notes ?? null
    };

    const { data, error } = await this.supabase
      .from("trips")
        .insert(payload)
        .select()
      .single();

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data;
  }

  async updateTrip(input: TripUpdateInput): Promise<Tables<"trips">> {
    const payload: Database["public"]["Tables"]["trips"]["Update"] = {
      title: input.title,
      destination: input.destination,
      start_date: input.startDate,
      end_date: input.endDate,
      party_size: input.partySize ?? 1,
      preferences: input.preferences ?? [],
      budget: input.budget ?? null,
      currency: input.currency ?? "CNY",
      notes: input.notes ?? null
    };

    const { data, error } = await this.supabase
      .from("trips")
      .update(payload)
      .eq("id", input.id)
      .eq("user_id", this.userId)
        .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found" });
      }

      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data;
  }

  async deleteTrip(tripId: string): Promise<void> {
    const { error } = await this.supabase
      .from("trips")
      .delete()
      .eq("id", tripId)
      .eq("user_id", this.userId);

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }
  }
}
