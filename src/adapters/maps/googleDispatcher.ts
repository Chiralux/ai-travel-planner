import { ProxyAgent, type Dispatcher } from "undici";

type DispatcherState = {
  initialized: boolean;
  dispatcher: Dispatcher | null;
};

const state: DispatcherState = {
  initialized: false,
  dispatcher: null
};

export function getGoogleMapsDispatcher(): Dispatcher | null {
  if (state.initialized) {
    return state.dispatcher;
  }

  const proxyUrl =
    process.env.GOOGLE_MAPS_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null;

  if (!proxyUrl) {
    state.initialized = true;
    state.dispatcher = null;
    return null;
  }

  try {
    state.dispatcher = new ProxyAgent(proxyUrl);
  } catch (error) {
    state.dispatcher = null;

    if (process.env.NODE_ENV !== "production") {
      console.warn("[GoogleMaps] Failed to configure proxy agent", { proxyUrl, error });
    }
  } finally {
    state.initialized = true;
  }

  return state.dispatcher;
}
