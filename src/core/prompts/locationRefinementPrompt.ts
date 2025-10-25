const LOCATION_REFINE_SCHEMA = `{
  "refined_name": string | null,
  "address_hint": string | null,
  "search_queries": string[],
  "nearby_landmarks": string[],
  "latitude": number | null,
  "longitude": number | null,
  "confidence": number | null,
  "reason": string
}`;

export const locationRefinementSystemPrompt = `You are an assistant that specializes in locating travel activities in Chinese cities.\nAlways respond with a strict JSON object that matches the following schema:\n${LOCATION_REFINE_SCHEMA}\n\nGuidelines:\n- Only provide latitude and longitude when you are confident they are correct. Otherwise set both to null.\n- Suggest up to three high-quality search queries that will help map APIs find the place.\n- Include any nearby landmarks, transit stations, or mall names that uniquely identify the location.\n- Keep the response concise and purely informational. No extra text outside the JSON.`;

export type LocationRefinementPromptInput = {
  destination: string;
  activityTitle: string;
  kind?: string;
  timeSlot?: string;
  existingAddress?: string;
  existingNote?: string;
  dayLabel?: string;
  previousActivities?: Array<{ title: string; address?: string }>;
};

export function locationRefinementUserPrompt(input: LocationRefinementPromptInput): string {
  const lines: string[] = [];

  lines.push(`目的地: ${input.destination}`);
  lines.push(`活动: ${input.activityTitle}`);

  if (input.kind) {
    lines.push(`类型: ${input.kind}`);
  }

  if (input.dayLabel) {
    lines.push(`行程日: ${input.dayLabel}`);
  }

  if (input.timeSlot) {
    lines.push(`时间段: ${input.timeSlot}`);
  }

  if (input.existingAddress) {
    lines.push(`现有地址: ${input.existingAddress}`);
  }

  if (input.existingNote) {
    lines.push(`备注: ${input.existingNote}`);
  }

  if (input.previousActivities && input.previousActivities.length > 0) {
    const formatted = input.previousActivities
      .map((item) => item.address ? `${item.title}（${item.address}）` : item.title)
      .join("；");
    lines.push(`已确认地点: ${formatted}`);
  }

  lines.push("请根据以上信息补充该活动的最准确信息。");

  return lines.join("\n");
}
