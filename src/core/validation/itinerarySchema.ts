import { z } from "zod";

// Single itinerary activity item with optional metadata.
const activitySchema = z
  .object({
    kind: z.enum(["sight", "food", "transport", "hotel", "other"]),
    title: z.string().min(1, "Activity title is required"),
    time_slot: z.string().optional(),
    note: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().optional(),
    cost_estimate: z.number().nonnegative().optional()
  })
  .describe("Single itinerary activity entry");

// Per-day plan grouping multiple activities.
const dailyPlanSchema = z
  .object({
    day: z.string().min(1, "Day label is required"),
    activities: z.array(activitySchema).default([])
  })
  .describe("Plan for a single day");

// Overall itinerary contract passed between layers.
export const itinerarySchema = z
  .object({
    destination: z.string().min(1, "Destination is required"),
    days: z.number().int().positive(),
    budget_estimate: z.number().nonnegative().optional(),
    party_size: z.number().int().positive().optional(),
    preference_tags: z.array(z.string()).default([]),
    daily_plan: z.array(dailyPlanSchema).default([]),
    tips: z.string().optional()
  })
  .describe("Itinerary payload contract");

export type Activity = z.infer<typeof activitySchema>;
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export type Itinerary = z.infer<typeof itinerarySchema>;
