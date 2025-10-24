const digitMap: Record<string, number> = {
  "零": 0,
  "〇": 0,
  "一": 1,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9
};

const unitMap: Record<string, number> = {
  "十": 10,
  "百": 100,
  "千": 1000,
  "万": 10000
};

export type ParsedTravelInput = {
  destination?: string;
  days?: number;
  budget?: number;
  partySize?: number;
  preferences?: string[];
};

const preferenceSynonyms: Record<string, string> = {
  "亲子": "亲子",
  "带孩子": "亲子",
  "带小孩": "亲子",
  "带娃": "亲子",
  "儿童": "亲子",
  "小朋友": "亲子",
  "美食": "美食",
  "吃": "美食",
  "美味": "美食",
  "餐厅": "美食",
  "文化": "文化",
  "历史": "文化",
  "博物馆": "文化",
  "艺术": "艺术",
  "展览": "艺术",
  "动漫": "艺术",
  "户外": "户外",
  "自然": "户外",
  "徒步": "户外",
  "夜生活": "夜生活",
  "酒吧": "夜生活",
  "音乐": "夜生活",
  "亲朋": "亲子"
};

function chineseToNumber(input: string): number | null {
  if (!input) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(input)) {
    return Number(input);
  }

  let total = 0;
  let current = 0;
  let lastUnit = 1;

  for (const char of input) {
    if (char in digitMap) {
      current = digitMap[char];
    } else if (char in unitMap) {
      const unit = unitMap[char];
      if (unit === 10000) {
        total = (total + current) * unit;
        current = 0;
      } else {
        current = (current || 1) * unit;
        total += current;
        current = 0;
      }
      lastUnit = unit;
    } else if (char === "点") {
      const integerPart = total + current;
      const decimalStr = input.split("点")[1];
      if (!decimalStr) {
        return integerPart;
      }
      let multiplier = 0.1;
      let decimals = 0;
      for (const decimalChar of decimalStr) {
        if (!(decimalChar in digitMap)) {
          break;
        }
        decimals += digitMap[decimalChar] * multiplier;
        multiplier /= 10;
      }
      return integerPart + decimals;
    } else {
      return null;
    }
  }

  if (current !== 0) {
    total += current;
  }

  return total || (lastUnit === 10 ? 10 : null);
}

function normalizeNumber(raw: string | undefined | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.replace(/[\s,，]/g, "");
  const value = chineseToNumber(cleaned);
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function extractDestination(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, "");
  const patterns = [
    /(?:去|到|想去|想到|计划去)([\u4e00-\u9fa5A-Za-z]{2,20})/,
    /目的地(?:是|为)?([\u4e00-\u9fa5A-Za-z]{2,20})/
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function extractDays(text: string): number | undefined {
  const match = text.match(/([\d一二三四五六七八九十两百千万]+)\s*(?:天|日)/);
  const value = normalizeNumber(match?.[1]);
  return value ? Math.max(1, Math.round(value)) : undefined;
}

function extractBudget(text: string): number | undefined {
  const budgetPattern = /预算[^\d一二三四五六七八九十两百千万]*([\d一二三四五六七八九十两百千万]+(?:\.\d+)?)(?:\s*)(万|千|百)?/;
  const match = text.match(budgetPattern);
  if (!match) {
    return undefined;
  }

  const base = normalizeNumber(match[1]);
  if (typeof base !== "number") {
    return undefined;
  }

  const unit = match[2];
  if (unit === "万") {
    return Math.round(base * 10000);
  }
  if (unit === "千") {
    return Math.round(base * 1000);
  }
  if (unit === "百") {
    return Math.round(base * 100);
  }

  return Math.round(base);
}

function extractPartySize(text: string): number | undefined {
  const match = text.match(/([\d一二三四五六七八九十两百千万]+)\s*(?:人|位|口)/);
  const value = normalizeNumber(match?.[1]);
  if (!value) {
    if (/一家三口/.test(text)) {
      return 3;
    }
    if (/一家四口/.test(text)) {
      return 4;
    }
    return undefined;
  }
  return Math.max(1, Math.round(value));
}

function extractPreferences(text: string, knownPreferences: string[] = []): string[] {
  const results = new Set<string>();

  const lowerKnown = knownPreferences.map((pref) => pref.toLowerCase());

  const maybePreferenceSegments = [] as string[];
  const likeMatch = text.match(/(?:喜欢|偏好|喜好|想体验)([^。！？\n]+)/);
  if (likeMatch?.[1]) {
    maybePreferenceSegments.push(likeMatch[1]);
  }

  const preferenceKeywords = Object.keys(preferenceSynonyms);
  for (const keyword of preferenceKeywords) {
    if (text.includes(keyword)) {
      results.add(preferenceSynonyms[keyword]);
    }
  }

  const segments = maybePreferenceSegments.flatMap((segment) =>
    segment
      .split(/[、，,\/\s和及]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );

  const normalize = (value: string) => value.replace(/(喜欢|想去|体验|等)$/, "").trim();

  for (const segment of segments) {
    const normalized = normalize(segment);
    if (!normalized) {
      continue;
    }
    if (preferenceSynonyms[normalized]) {
      results.add(preferenceSynonyms[normalized]);
    } else {
      // Respect existing checkbox options, but allow custom inputs as fallback.
      const knownIndex = lowerKnown.findIndex((pref) => pref === normalized.toLowerCase());
      if (knownIndex !== -1) {
        results.add(knownPreferences[knownIndex]);
      } else {
        results.add(normalized);
      }
    }
  }

  return Array.from(results);
}

export function parseTravelInput(
  text: string,
  options: { knownPreferences?: string[] } = {}
): ParsedTravelInput | null {
  const cleaned = text.trim();

  if (!cleaned) {
    return null;
  }

  const destination = extractDestination(cleaned);
  const days = extractDays(cleaned);
  const budget = extractBudget(cleaned);
  const partySize = extractPartySize(cleaned);
  const preferences = extractPreferences(cleaned, options.knownPreferences ?? []);

  if (!destination && !days && !budget && !partySize && preferences.length === 0) {
    return null;
  }

  return {
    destination,
    days,
    budget,
    partySize,
    preferences: preferences.length > 0 ? preferences : undefined
  };
}

type PlannerFormLike = {
  destination: string;
  days: number;
  budget?: number;
  partySize?: number;
  preferences: string[];
};

type PlannerStoreLike = {
  form: PlannerFormLike;
  setField: <K extends keyof PlannerFormLike>(key: K, value: PlannerFormLike[K]) => void;
};

export function mergeParsedInput(
  store: PlannerStoreLike,
  parsed: ParsedTravelInput
) {
  if (parsed.destination) {
    store.setField("destination", parsed.destination);
  }
  if (typeof parsed.days === "number") {
    store.setField("days", Math.max(1, parsed.days));
  }
  if (typeof parsed.budget === "number") {
    store.setField("budget", Math.max(0, parsed.budget));
  }
  if (typeof parsed.partySize === "number") {
    store.setField("partySize", Math.max(1, parsed.partySize));
  }
  if (parsed.preferences) {
    const existing = store.form.preferences ?? [];
    const merged = Array.from(new Set([...existing, ...parsed.preferences]));
    store.setField("preferences", merged);
  }
}
