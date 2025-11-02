import { create } from "zustand";
import type { MapProvider } from "../../src/lib/maps/provider";
import type { Activity, Itinerary } from "../../src/core/validation/itinerarySchema";

export type PlannerForm = {
  destination: string;
  days: number;
  budget?: number;
  partySize?: number;
  preferences: string[];
  origin?: string;
  originCoords?: {
    lat: number;
    lng: number;
  };
};

type FocusableMarker = {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
};

export type PlannerRoute = {
  points: Array<{ lat: number; lng: number }>;
  distanceMeters: number;
  durationSeconds: number;
  origin?: FocusableMarker;
  destination?: FocusableMarker;
  mode: "driving" | "walking" | "cycling" | "transit";
  provider?: MapProvider;
};

type PlannerState = {
  form: PlannerForm;
  result: Itinerary | null;
  loading: boolean;
  error: string | null;
  focusedMarker: FocusableMarker | null;
  focusHistory: FocusableMarker[];
  activeRoute: PlannerRoute | null;
  setField: <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => void;
  togglePreference: (value: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (itinerary: Itinerary | null) => void;
  setFocusedMarker: (marker: FocusableMarker | null) => void;
  goBackToPreviousMarker: () => void;
  setForm: (form: PlannerForm) => void;
  hydrateFromPlan: (payload: { form: PlannerForm; itinerary: Itinerary }) => void;
  updateActivity: (dayIndex: number, activityIndex: number, updates: Partial<Activity>) => void;
  setRoute: (route: PlannerRoute | null) => void;
  clearRoute: () => void;
  reset: () => void;
};

const defaultForm: PlannerForm = {
  destination: "",
  days: 3,
  preferences: []
};

const normalizeForm = (incoming: PlannerForm): PlannerForm => ({
  destination: incoming.destination ?? "",
  days: Math.max(1, Number.isFinite(incoming.days) ? Math.trunc(incoming.days) : 1),
  budget: typeof incoming.budget === "number" ? Math.max(0, incoming.budget) : undefined,
  partySize: typeof incoming.partySize === "number" ? Math.max(1, incoming.partySize) : undefined,
  preferences: Array.isArray(incoming.preferences) ? [...new Set(incoming.preferences)] : [],
  origin: incoming.origin ?? undefined,
  originCoords: incoming.originCoords ? { ...incoming.originCoords } : undefined
});

const formatAddressWithConfidence = (address?: string, confidence?: number): string | undefined => {
  if (!address) {
    return undefined;
  }

  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return address;
  }

  const percent = Math.round(confidence * 100);
  const clamped = Math.min(Math.max(percent, 0), 100);

  return `${address}（置信度 ${clamped}%）`;
};

export const usePlannerStore = create<PlannerState>((set) => ({
  form: defaultForm,
  result: null,
  loading: false,
  error: null,
  focusedMarker: null,
  focusHistory: [],
  activeRoute: null,
  setField: (key, value) =>
    set((state) => ({
      form: {
        ...state.form,
        [key]: value
      }
    })),
  togglePreference: (value) =>
    set((state) => {
      const exists = state.form.preferences.includes(value);
      const preferences = exists
        ? state.form.preferences.filter((item) => item !== value)
        : [...state.form.preferences, value];

      return {
        form: {
          ...state.form,
          preferences
        }
      };
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setResult: (itinerary) =>
    set({ result: itinerary, focusedMarker: null, focusHistory: [], activeRoute: null }),
  setFocusedMarker: (marker) =>
    set((state) => {
      if (!marker) {
        return {
          focusedMarker: null,
          focusHistory: []
        };
      }

      const current = state.focusedMarker;
      const isSameMarker = current
        ? Math.abs(current.lat - marker.lat) < 1e-6 &&
          Math.abs(current.lng - marker.lng) < 1e-6 &&
          current.label === marker.label &&
          current.address === marker.address
        : false;

      if (isSameMarker) {
        return {
          focusedMarker: { ...marker }
        };
      }

      const nextHistory = current
        ? [...state.focusHistory.slice(-19), current]
        : state.focusHistory;

      return {
        focusedMarker: marker,
        focusHistory: nextHistory
      };
    }),
  goBackToPreviousMarker: () =>
    set((state) => {
      if (state.focusHistory.length === 0) {
        return {};
      }

      const nextHistory = state.focusHistory.slice(0, -1);
      const previous = state.focusHistory[state.focusHistory.length - 1];

      return {
        focusedMarker: previous,
        focusHistory: nextHistory
      };
    }),
  setForm: (form) =>
    set(() => ({
      form: normalizeForm({ ...defaultForm, ...form, preferences: form.preferences ?? [] }),
      activeRoute: null
    })),
  hydrateFromPlan: ({ form, itinerary }) =>
    set(() => ({
      form: normalizeForm({ ...defaultForm, ...form, preferences: form.preferences ?? [] }),
      result: itinerary,
      error: null,
      focusedMarker: null,
      focusHistory: [],
      activeRoute: null
    })),
  updateActivity: (dayIndex, activityIndex, updates) =>
    set((state) => {
      if (!state.result) {
        return state;
      }

      if (dayIndex < 0 || dayIndex >= state.result.daily_plan.length) {
        return state;
      }

      const day = state.result.daily_plan[dayIndex];

      if (activityIndex < 0 || activityIndex >= day.activities.length) {
        return state;
      }

      const nextActivity: Activity = {
        ...day.activities[activityIndex],
        ...updates
      };

      const nextDailyPlan = state.result.daily_plan.map((currentDay, currentDayIndex) => {
        if (currentDayIndex !== dayIndex) {
          return currentDay;
        }

        const nextActivities = currentDay.activities.map((currentActivity, currentActivityIndex) =>
          currentActivityIndex === activityIndex ? nextActivity : currentActivity
        );

        return {
          ...currentDay,
          activities: nextActivities
        };
      });

      return {
        result: {
          ...state.result,
          daily_plan: nextDailyPlan
        }
      };
    }),
  setRoute: (route) =>
    set(() => ({
      activeRoute: route
    })),
  clearRoute: () =>
    set(() => ({
      activeRoute: null
    })),
  reset: () =>
    set(() => ({
      form: normalizeForm(defaultForm),
      result: null,
      loading: false,
      error: null,
      focusedMarker: null,
      focusHistory: [],
      activeRoute: null
    }))
}));

export const mapMarkersSelector = (state: PlannerState) => {
  const markers: Array<{
    lat: number;
    lng: number;
    label: string;
    address?: string;
    sequenceLabel?: string;
    sequenceGroup?: Array<{
      sequence: number;
      label: string;
      address?: string;
    }>;
  }> = [];

  if (state.form.originCoords) {
    markers.push({
      lat: state.form.originCoords.lat,
      lng: state.form.originCoords.lng,
      label: state.form.origin ? `出发地：${state.form.origin}` : "出发地"
    });
  }

  let sequence = 1;

  const normalizeCoords = (lat?: number, lng?: number): { lat: number; lng: number } | null => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    let normalizedLat = lat as number;
    let normalizedLng = lng as number;

    const absLat = Math.abs(normalizedLat);
    const absLng = Math.abs(normalizedLng);

    if (absLat > 90 && absLng <= 90) {
      [normalizedLat, normalizedLng] = [normalizedLng, normalizedLat];
    }

    if (Math.abs(normalizedLat) > 90 || Math.abs(normalizedLng) > 180) {
      return null;
    }

    return { lat: normalizedLat, lng: normalizedLng };
  };

  if (!state.result) {
    return markers;
  }

  type MarkerEntry = {
    sequence: number;
    title: string;
    address?: string;
  };

  const grouped = new Map<
    string,
    {
      lat: number;
      lng: number;
      entries: MarkerEntry[];
    }
  >();

  for (const day of state.result.daily_plan) {
    for (const activity of day.activities) {
      const currentSequence = sequence;
      sequence += 1;
      const coords = normalizeCoords(activity.lat, activity.lng);

      if (!coords) {
        continue;
      }

      const duplicateKey = `${coords.lat.toFixed(6)}:${coords.lng.toFixed(6)}`;
      if (!grouped.has(duplicateKey)) {
        grouped.set(duplicateKey, {
          lat: coords.lat,
          lng: coords.lng,
          entries: []
        });
      }

      grouped.get(duplicateKey)!.entries.push({
        sequence: currentSequence,
        title: activity.title,
        address: formatAddressWithConfidence(activity.address, activity.maps_confidence)
      });
    }
  }

  for (const group of grouped.values()) {
    const sortedEntries = [...group.entries].sort((a, b) => a.sequence - b.sequence);
    const titles = sortedEntries.map((entry) => entry.title).filter(Boolean);
    const label = titles.length === 0 ? "行程活动" : titles.join(" / ");
    const firstAddress = sortedEntries.find((entry) => Boolean(entry.address))?.address;
    const sequenceLabel = sortedEntries.map((entry) => entry.sequence).join("·");

    markers.push({
      lat: group.lat,
      lng: group.lng,
      label,
      address: firstAddress,
      sequenceLabel: sequenceLabel || undefined,
      sequenceGroup: sortedEntries.map((entry) => ({
        sequence: entry.sequence,
        label: entry.title,
        address: entry.address
      }))
    });
  }

  return markers;
};

export type PlannerStore = PlannerState;
