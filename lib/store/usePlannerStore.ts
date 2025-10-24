import { create } from "zustand";
import type { Itinerary } from "../../src/core/validation/itinerarySchema";

type PlannerForm = {
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

type PlannerState = {
  form: PlannerForm;
  result: Itinerary | null;
  loading: boolean;
  error: string | null;
  focusedMarker: {
    lat: number;
    lng: number;
    label?: string;
    address?: string;
  } | null;
  setField: <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => void;
  togglePreference: (value: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (itinerary: Itinerary | null) => void;
  setFocusedMarker: (
    marker: {
      lat: number;
      lng: number;
      label?: string;
      address?: string;
    } | null
  ) => void;
};

const defaultForm: PlannerForm = {
  destination: "",
  days: 3,
  preferences: []
};

export const usePlannerStore = create<PlannerState>((set) => ({
  form: defaultForm,
  result: null,
  loading: false,
  error: null,
  focusedMarker: null,
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
  setResult: (itinerary) => set({ result: itinerary, focusedMarker: null }),
  setFocusedMarker: (marker) => set({ focusedMarker: marker })
}));

export const mapMarkersSelector = (state: PlannerState) => {
  const markers: Array<{
    lat: number;
    lng: number;
    label: string;
    address?: string;
    sequence?: number;
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

  for (const day of state.result.daily_plan) {
    for (const activity of day.activities) {
      const coords = normalizeCoords(activity.lat, activity.lng);

      if (coords) {
        markers.push({
          lat: coords.lat,
          lng: coords.lng,
          label: activity.title,
          address: activity.address,
          sequence: sequence++
        });
      }
    }
  }

  return markers;
};

export type PlannerStore = PlannerState;
