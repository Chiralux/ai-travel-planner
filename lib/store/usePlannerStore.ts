import { create } from "zustand";
import type { Itinerary } from "../../src/core/validation/itinerarySchema";

type PlannerForm = {
  destination: string;
  days: number;
  budget?: number;
  partySize?: number;
  preferences: string[];
};

type PlannerState = {
  form: PlannerForm;
  result: Itinerary | null;
  loading: boolean;
  error: string | null;
  setField: <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => void;
  togglePreference: (value: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (itinerary: Itinerary | null) => void;
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
  setResult: (itinerary) => set({ result: itinerary })
}));

export const mapMarkersSelector = (state: PlannerState) => {
  const markers: Array<{
    lat: number;
    lng: number;
    label: string;
    address?: string;
  }> = [];

  if (!state.result) {
    return markers;
  }

  for (const day of state.result.daily_plan) {
    for (const activity of day.activities) {
      if (typeof activity.lat === "number" && typeof activity.lng === "number") {
        markers.push({
          lat: activity.lat,
          lng: activity.lng,
          label: activity.title,
          address: activity.address
        });
      }
    }
  }

  return markers;
};

export type PlannerStore = PlannerState;
