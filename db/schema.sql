-- Schema for AI Travel Planner Supabase project
-- Generated to support per-user travel planning with strict RLS guarantees.

-- Enable required extensions -------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Utility --------------------------------------------------------------------
create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

-- User preferences ------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_currency text not null default 'CNY',
  default_language text not null default 'zh-CN',
  budget_alert_threshold numeric(4,2) not null default 0.90,
  enable_usage_tracking boolean not null default false,
  notification_channel text default 'email',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_timestamp_user_preferences
before update on public.user_preferences
for each row execute function public.trigger_set_timestamp();

-- Trips -----------------------------------------------------------------------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  destination text not null,
  start_date date not null,
  end_date date not null,
  party_size integer not null default 1 check (party_size > 0),
  preferences text[] not null default '{}',
  budget numeric(12,2),
  currency text not null default 'CNY',
  notes text,
  synced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists trips_user_id_idx on public.trips(user_id);
create index if not exists trips_destination_idx on public.trips(lower(destination));

create trigger set_timestamp_trips
before update on public.trips
for each row execute function public.trigger_set_timestamp();

-- Saved travel plans ----------------------------------------------------------
create table if not exists public.travel_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  summary text,
  form_snapshot jsonb not null default '{}'::jsonb,
  itinerary_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists travel_plans_user_id_idx on public.travel_plans(user_id);
create index if not exists travel_plans_updated_at_idx on public.travel_plans(updated_at desc);

create trigger set_timestamp_travel_plans
before update on public.travel_plans
for each row execute function public.trigger_set_timestamp();

-- Trip days -------------------------------------------------------------------
create table if not exists public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index integer not null check (day_index >= 0),
  trip_date date not null,
  theme text,
  summary text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (trip_id, day_index)
);

create index if not exists trip_days_trip_id_idx on public.trip_days(trip_id);

create trigger set_timestamp_trip_days
before update on public.trip_days
for each row execute function public.trigger_set_timestamp();

-- Places ----------------------------------------------------------------------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  address text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists places_user_id_idx on public.places(user_id);
create index if not exists places_external_id_idx on public.places(external_id);

create trigger set_timestamp_places
before update on public.places
for each row execute function public.trigger_set_timestamp();

-- Activities ------------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_day_id uuid references public.trip_days(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid references public.places(id),
  title text not null,
  kind text not null default 'other',
  start_time time,
  end_time time,
  note text,
  cost_estimate numeric(12,2),
  currency text not null default 'CNY',
  lat double precision,
  lng double precision,
  confidence numeric(4,3),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists activities_trip_id_idx on public.activities(trip_id);
create index if not exists activities_trip_day_id_idx on public.activities(trip_day_id);
create index if not exists activities_user_id_idx on public.activities(user_id);

create trigger set_timestamp_activities
before update on public.activities
for each row execute function public.trigger_set_timestamp();

-- Expenses --------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'CNY',
  category text not null default 'other',
  method text,
  note text,
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists expenses_trip_id_idx on public.expenses(trip_id);
create index if not exists expenses_user_id_idx on public.expenses(user_id);
create index if not exists expenses_recorded_at_idx on public.expenses(recorded_at desc);

create trigger set_timestamp_expenses
before update on public.expenses
for each row execute function public.trigger_set_timestamp();

-- Row Level Security ----------------------------------------------------------
alter table public.user_preferences enable row level security;
alter table public.trips enable row level security;
alter table public.trip_days enable row level security;
alter table public.places enable row level security;
alter table public.activities enable row level security;
alter table public.expenses enable row level security;
alter table public.travel_plans enable row level security;

-- Suggested RLS policies (apply via Supabase dashboard or SQL migrations):
-- 1. Ensure records are only visible to their owner.
--    create policy "Users can view own rows" on public.trips
--      for select using (auth.uid() = user_id);
-- 2. Allow inserts that set user_id to the authenticated user.
--    create policy "Users can insert own rows" on public.trips
--      for insert with check (auth.uid() = user_id);
-- 3. Apply matching policies to trip_days, activities, expenses and places using
--    joins back to trips or direct user_id comparisons.
-- 4. Grant service role (Edge functions) access via postgres role members only.

-- Additional reference indexes / views can be added as analytics needs evolve.
