import { itinerarySchema } from "../src/core/validation/itinerarySchema";
import { expenseSchema } from "../src/core/validation/expenseSchema";

const itinerary = itinerarySchema.parse({
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
  party_size: 3
});

console.log("Itinerary destination:", itinerary.destination);

try {
  itinerarySchema.parse({ days: 2 } as unknown);
} catch (error) {
  console.log("Invalid itinerary rejected:", error instanceof Error);
}

const expense = expenseSchema.parse({
  trip_id: "11111111-1111-1111-1111-111111111111",
  amount: 120,
  category: "food"
});

console.log("Expense amount:", expense.amount);

try {
  expenseSchema.parse({ trip_id: "bad", amount: -10, category: "food" } as unknown);
} catch (error) {
  console.log("Invalid expense rejected:", error instanceof Error);
}
