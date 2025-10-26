export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      user_preferences: {
        Row: {
          user_id: string;
          default_currency: string;
          default_language: string;
          budget_alert_threshold: number;
          enable_usage_tracking: boolean;
          notification_channel: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          default_currency?: string;
          default_language?: string;
          budget_alert_threshold?: number;
          enable_usage_tracking?: boolean;
          notification_channel?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          default_currency?: string;
          default_language?: string;
          budget_alert_threshold?: number;
          enable_usage_tracking?: boolean;
          notification_channel?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      trips: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          destination: string;
          start_date: string;
          end_date: string;
          party_size: number;
          preferences: string[];
          budget: number | null;
          currency: string;
          notes: string | null;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          destination: string;
          start_date: string;
          end_date: string;
          party_size?: number;
          preferences?: string[];
          budget?: number | null;
          currency?: string;
          notes?: string | null;
          synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          destination?: string;
          start_date?: string;
          end_date?: string;
          party_size?: number;
          preferences?: string[];
          budget?: number | null;
          currency?: string;
          notes?: string | null;
          synced_at?: string | null;
          updated_at?: string;
        };
      };
      trip_days: {
        Row: {
          id: string;
          trip_id: string;
          day_index: number;
          trip_date: string;
          theme: string | null;
          summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          day_index: number;
          trip_date: string;
          theme?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          trip_id?: string;
          day_index?: number;
          trip_date?: string;
          theme?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      places: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          address: string | null;
          city: string | null;
          country: string | null;
          lat: number | null;
          lng: number | null;
          source: string | null;
          external_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          address?: string | null;
          city?: string | null;
          country?: string | null;
          lat?: number | null;
          lng?: number | null;
          source?: string | null;
          external_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          address?: string | null;
          city?: string | null;
          country?: string | null;
          lat?: number | null;
          lng?: number | null;
          source?: string | null;
          external_id?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
      };
      activities: {
        Row: {
          id: string;
          trip_id: string;
          trip_day_id: string | null;
          user_id: string;
          place_id: string | null;
          title: string;
          kind: string;
          start_time: string | null;
          end_time: string | null;
          note: string | null;
          cost_estimate: number | null;
          currency: string;
          lat: number | null;
          lng: number | null;
          confidence: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          trip_day_id?: string | null;
          user_id: string;
          place_id?: string | null;
          title: string;
          kind?: string;
          start_time?: string | null;
          end_time?: string | null;
          note?: string | null;
          cost_estimate?: number | null;
          currency?: string;
          lat?: number | null;
          lng?: number | null;
          confidence?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          trip_day_id?: string | null;
          place_id?: string | null;
          title?: string;
          kind?: string;
          start_time?: string | null;
          end_time?: string | null;
          note?: string | null;
          cost_estimate?: number | null;
          currency?: string;
          lat?: number | null;
          lng?: number | null;
          confidence?: number | null;
          updated_at?: string;
        };
      };
      expenses: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          activity_id: string | null;
          amount: number;
          currency: string;
          category: string;
          method: string | null;
          note: string | null;
          recorded_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          activity_id?: string | null;
          amount: number;
          currency?: string;
          category?: string;
          method?: string | null;
          note?: string | null;
          recorded_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          activity_id?: string | null;
          amount?: number;
          currency?: string;
          category?: string;
          method?: string | null;
          note?: string | null;
          recorded_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
