import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import type { Database, Json, Tables } from "../lib/supabase/types";
import type { Itinerary } from "../core/validation/itinerarySchema";

export type PlannerFormSnapshot = {
  destination: string;
  days: number;
  budget?: number;
  partySize?: number;
  preferences: string[];
  origin?: string;
  originCoords?: {
    lat: number;
    lng: number;
  };
};

export type PlanSummary = {
  id: string;
  title: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanDetail = {
  id: string;
  title: string;
  summary: string | null;
  form: PlannerFormSnapshot;
  itinerary: Itinerary;
  createdAt: string;
  updatedAt: string;
};

type PlanServiceDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

type SavePlanInput = {
  id?: string;
  title: string;
  summary?: string | null;
  form: PlannerFormSnapshot;
  itinerary: Itinerary;
};

const jsonSerialize = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null));
type TravelPlanRow = Tables<"travel_plans">;

export class PlanService {
  private readonly supabase: SupabaseClient<Database>;
  private readonly userId: string;

  constructor({ supabase, userId }: PlanServiceDeps) {
    this.supabase = supabase;
    this.userId = userId;
  }

  async listPlans(): Promise<PlanSummary[]> {
    const query = this.supabase
      .from("travel_plans")
      .select("id,title,summary,created_at,updated_at")
      .eq("user_id", this.userId)
      .order("updated_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    const rows = (data ?? []) as unknown as Array<Pick<TravelPlanRow, "id" | "title" | "summary" | "created_at" | "updated_at">>;

    return rows.map((plan) => ({
      id: plan.id,
      title: plan.title,
      summary: plan.summary ?? null,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at
    }));
  }

  async getPlan(planId: string): Promise<PlanDetail | null> {
    const query = this.supabase
      .from("travel_plans")
      .select("*")
      .eq("id", planId)
      .eq("user_id", this.userId)
      .maybeSingle();

    const { data, error } = await query;

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    if (!data) {
      return null;
    }

    const row = data as TravelPlanRow;

    return {
      id: row.id,
      title: row.title,
      summary: row.summary ?? null,
      form: (row.form_snapshot as PlannerFormSnapshot) ?? ({} as PlannerFormSnapshot),
      itinerary: row.itinerary_snapshot as Itinerary,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async savePlan(input: SavePlanInput): Promise<TravelPlanRow> {
    const payload: Database["public"]["Tables"]["travel_plans"]["Insert"] = {
      user_id: this.userId,
      title: input.title,
      summary: input.summary ?? null,
      form_snapshot: jsonSerialize(input.form),
      itinerary_snapshot: jsonSerialize(input.itinerary)
    };

    if (input.id) {
      const updatePayload: Database["public"]["Tables"]["travel_plans"]["Update"] = {
        title: input.title,
        summary: input.summary ?? null,
        form_snapshot: jsonSerialize(input.form),
        itinerary_snapshot: jsonSerialize(input.itinerary)
      };

      const { data, error } = await this.supabase
        .from("travel_plans")
        .update(updatePayload as never)
        .eq("id", input.id)
        .eq("user_id", this.userId)
        .select()
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return data as TravelPlanRow;
    }

    const { data, error } = await this.supabase
      .from("travel_plans")
      .insert(payload as never)
      .select()
      .single();

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }

    return data as TravelPlanRow;
  }

  async deletePlan(planId: string): Promise<void> {
    const { error } = await this.supabase
      .from("travel_plans")
      .delete()
      .eq("id", planId)
      .eq("user_id", this.userId);

    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    }
  }
}
