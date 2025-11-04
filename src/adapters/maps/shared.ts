// Reuse the request helper shipped with @ant-design/maps when possible, while
// keeping a fetch-based fallback for environments where the package is absent.
type RequestLike = <T = unknown>(input: string, init?: RequestInit) => Promise<T | Response>;

let cachedRequest: RequestLike | null = null;

async function resolveRequest(): Promise<RequestLike> {
  if (cachedRequest) {
    return cachedRequest;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
  const mapsModule = await import("@ant-design/maps");
  const candidate = (mapsModule as Record<string, unknown>).request;

      if (typeof candidate === "function") {
        cachedRequest = candidate as RequestLike;
        return cachedRequest;
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[@ant-design/maps] request helper unavailable in browser, falling back to fetch", error);
      }
    }
  }

  cachedRequest = async <T>(input: string, init?: RequestInit) => {
    const response = await fetch(input, init);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  };

  return cachedRequest;
}

export async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const requester = await resolveRequest();
  const result = await requester<T | Response>(input, init);

  if (typeof Response !== "undefined" && result instanceof Response) {
    if (!result.ok) {
      throw new Error(`Request failed with status ${result.status}`);
    }

    return (await result.json()) as T;
  }

  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T;
    } catch (error) {
      throw new Error("Unable to parse string response as JSON");
    }
  }

  return result as T;
}
