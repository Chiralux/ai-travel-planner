import { z } from "zod";

// Expense payload shared across client/server.
export const expenseSchema = z
  .object({
    trip_id: z.string().uuid("Trip identifier must be a UUID"),
    amount: z.number().positive("Expense amount must be positive"),
    category: z.enum(["food", "hotel", "transport", "tickets", "other"]),
    occurred_at: z.string().datetime().optional(),
    note: z.string().optional(),
    source: z.enum(["manual", "voice"]).default("manual")
  })
  .describe("Expense payload contract");

export type Expense = z.infer<typeof expenseSchema>;
