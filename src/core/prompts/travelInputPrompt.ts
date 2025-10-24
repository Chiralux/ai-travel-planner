import type { ParsedTravelInput } from "../utils/travelInputParser";

export const travelInputSystemPrompt = `You are an attentive travel assistant who extracts structured trip requirements from free-form Chinese text.
Return data as a JSON object with lowercase snake_case keys. Do not include explanatory text.
When a value is not provided, set it to null instead of guessing wildly.`;

export type TravelInputPromptContext = {
  originalText: string;
  knownPreferences?: string[];
  heuristicResult?: ParsedTravelInput | null;
};

export const travelInputUserPrompt = ({
  originalText,
  knownPreferences = [],
  heuristicResult
}: TravelInputPromptContext) => {
  const details: Record<string, unknown> = {
    input_text: originalText,
    known_preferences: knownPreferences,
    heuristic_parse: heuristicResult ?? null
  };

  return `请阅读以下旅行意图描述，并根据 JSON 模板抽取字段。
字段说明：
- destination: 旅行目的地，保留原文中的中文或地名。
- origin: 出发城市或地点，没有则为 null。
- days: 行程天数（正整数），未知则为 null。
- budget: 总预算（人民币，单位元，整数），未知则为 null。
- party_size: 总人数，未知则为 null。
- preferences: 旅行偏好标签数组，元素为字符串，可结合 known_preferences 与原文语义。
- notes: 补充说明数组，可为空数组。
请严格输出一个 JSON 对象，避免额外文本。

${JSON.stringify(details, null, 2)}`;
};
