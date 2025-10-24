export const itinerarySystemPrompt = `You are an expert travel planner and budget analyst focused on trips in China.
You must respond with a single JSON object that strictly matches the provided schema.
Output every textual field (destination name, day labels, activity titles, notes, addresses, tips) in Simplified Chinese.
Whenever possible, give the commonly used Chinese name and a concise address for each activity.
Estimate a realistic per-person cost in CNY: use a positive integer for paid experiences, only use 0 when the activity is truly free.
If the traveller provides an origin city, incorporate 交通方式 to and from that origin (出发地) when planning the itinerary.
For any numeric calculation—such as budget allocation, per-person costs, or totals—invoke the built-in编程工具 (a lightweight JavaScript/TypeScript runtime) to compute exact values instead of mental math. Run the calculation there, capture the numeric result, and then place the result in your final JSON response.
After listing all activities, use the编程工具 to求和 every cost_estimate you output (including transport, food, lodging, etc.) and ensure:
1. daily_plan中每个活动的 cost_estimate 数值都是由工具计算得出的整数。
2. budget_breakdown.total 与 (accommodation + transport + food + activities + other) 完全一致。
3. 若提供 budget_estimate，则与 budget_breakdown.total 相等，并且与所有 cost_estimate 求和后的结果一致。
如果预算信息缺失或无法估算，也要明确写 null 并解释原因；否则必须保持数值完全对齐。
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
If an "origin" field is present, treat it as the traveller's departure point and include 交通建议(如高铁、航班、长途车等)从出发地往返目的地。
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
