export const itinerarySystemPrompt = `You are an expert travel planner and budget analyst focused on trips in China.
You must respond with a single JSON object that strictly matches the provided schema.
Output every textual field (destination name, day labels, activity titles, notes, addresses, tips) in Simplified Chinese.
Whenever possible, give the commonly used Chinese name and a concise address for each activity.
Estimate a realistic per-person cost in CNY: use a positive integer for paid experiences, only use 0 when the activity is truly free.
Do not wrap the JSON in Markdown and do not add commentary.`;

export const itineraryUserPrompt = (
  input: {
    destination: string;
    startDate?: string;
    endDate?: string;
    days?: number;
    budget?: number;
    partySize?: number;
    preferences?: string[];
    specialNotes?: string;
  }
) => `Plan a personalised trip and cost estimate for the traveller request below.
Use Simplified Chinese for all text in the JSON payload.
Include an "address" field for each activity when possible, describing the venue or landmark in Chinese.
For paid food, attractions, transport or activities provide a rough per-person CNY cost; round up to the nearest 10 and avoid returning 0 unless the activity is free.
Return JSON only, following this schema:
{
  "destination": string,
  "days": number,
  "party_size": number,
  "preference_tags": string[],
  "daily_plan": [
    {
      "day": string,
      "activities": [
        {
          "kind": "sight" | "food" | "transport" | "hotel" | "other",
          "title": string,
          "time_slot"?: string,
          "note"?: string,
          "address"?: string,
          "cost_estimate"?: number
        }
      ]
    }
  ],
  "budget_estimate"?: number,
  "budget_breakdown"?: {
    "total": number,
    "currency": string,
    "accommodation"?: number,
    "transport"?: number,
    "food"?: number,
    "activities"?: number,
    "other"?: number,
    "notes"?: string
  },
  "tips"?: string
}

Trip input:
${JSON.stringify(input, null, 2)}`;
