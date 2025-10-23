import { describe, expect, it } from "vitest";

import { expenseSchema } from "./expenseSchema";
import { itinerarySchema } from "./itinerarySchema";

describe("itinerarySchema", () => {
  it("accepts valid itinerary", () => {
    const result = itinerarySchema.parse({
      destination: "Tokyo",
      days: 5,
      preference_tags: ["food"],
      daily_plan: [
        {
          day: "2025-03-01",
          activities: [
            {
              kind: "sight",
              title: "Visit Shinjuku Gyoen",
              cost_estimate: 20
            }
          ]
        }
      ],
      budget_estimate: 1000,
      budget_breakdown: {
        total: 1000,
        currency: "CNY",
        accommodation: 400,
        transport: 200,
        food: 250,
        activities: 150
      },
      party_size: 3
    });

    expect(result.destination).toBe("Tokyo");
    expect(result.daily_plan[0]?.activities[0]?.kind).toBe("sight");
  });

  it("rejects invalid itinerary", () => {
    expect(() => itinerarySchema.parse({ days: 2 } as unknown)).toThrowError();
  });
});

describe("expenseSchema", () => {
  it("accepts valid expense", () => {
    const result = expenseSchema.parse({
      trip_id: "11111111-1111-1111-1111-111111111111",
      amount: 120,
      category: "food"
    });

    expect(result.amount).toBe(120);
  });

  it("rejects invalid expense", () => {
    expect(() =>
      expenseSchema.parse({ trip_id: "bad", amount: -10, category: "food" } as unknown)
    ).toThrowError();
  });
});
