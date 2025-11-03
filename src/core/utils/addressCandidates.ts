const MIN_PREFIX_LENGTH = 6;

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u3000]+/gu, " ").trim();
}

function normalizePunctuation(value: string): string {
  return value.replace(/[，、。；;|｜]/gu, " ").replace(/[\s\u3000]+/gu, " ").trim();
}

function collectPrefixes(source: string): string[] {
  const prefixes: string[] = [];
  if (!source || source.length < MIN_PREFIX_LENGTH) {
    return prefixes;
  }

  const tokens = source.split(/[\s,，、。；;|｜]+/u).filter(Boolean);

  if (tokens.length > 1) {
    for (let length = tokens.length; length > 1; length -= 1) {
      const candidate = tokens.slice(0, length).join(" ").trim();
      if (candidate.length >= MIN_PREFIX_LENGTH) {
        prefixes.push(candidate);
      }
    }
    return prefixes;
  }

  for (let cut = source.length - 1; cut >= MIN_PREFIX_LENGTH; cut -= 2) {
    const candidate = source.slice(0, cut).trim();
    if (candidate.length >= MIN_PREFIX_LENGTH) {
      prefixes.push(candidate);
    } else {
      break;
    }
  }

  return prefixes;
}

export function generateAddressCandidates(rawAddress: string | undefined | null): string[] {
  if (!rawAddress) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    if (seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  add(rawAddress);

  const whitespaceNormalized = normalizeWhitespace(rawAddress);
  add(whitespaceNormalized);

  const punctuationNormalized = normalizePunctuation(whitespaceNormalized);
  add(punctuationNormalized);

  for (const prefix of collectPrefixes(punctuationNormalized)) {
    add(prefix);
  }

  return candidates;
}
