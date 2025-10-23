export const itinerarySystemPrompt = `You are an expert travel planner and budget analyst.
You must respond with a single JSON object that strictly matches the provided schema.
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
