"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Itinerary } from "../../src/core/validation/itinerarySchema";
import type { KeyboardEvent } from "react";

type FocusableMarker = {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
  photoUrl?: string;
};

type ItineraryTimelineProps = {
  itinerary?: Itinerary | null;
  onActivityFocus?: (marker: FocusableMarker) => void;
};

function formatConfidenceLabel(confidence?: number): string | null {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }

  const percent = Math.round(confidence * 100);
  const clamped = Math.min(Math.max(percent, 0), 100);

  return `置信度 ${clamped}%`;
}

async function fetchActivityPhotos(query: string, region?: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const params = new URLSearchParams({ q: query });

    if (region) {
      params.set("region", region);
    }

    const response = await fetch(`/api/activity-photos?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    const photos = Array.isArray((data as { photos?: unknown }).photos)
      ? ((data as { photos: unknown }).photos as unknown[])
      : [];

    return photos
      .filter((value): value is string => typeof value === "string" && value.startsWith("https://"))
      .slice(0, 4);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

type ActivityEntry = Itinerary["daily_plan"][number]["activities"][number];

type ActivityCardProps = {
  activity: ActivityEntry;
  destination: string;
  onActivityFocus?: (marker: FocusableMarker) => void;
};

function ActivityCard({ activity, destination, onActivityFocus }: ActivityCardProps) {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const hasCoords = typeof activity.lat === "number" && typeof activity.lng === "number";
  const confidenceLabel = formatConfidenceLabel(activity.maps_confidence);
  const addressLine = activity.address
    ? `${activity.address}${confidenceLabel ? `（${confidenceLabel}）` : ""}`
    : null;

  const searchTerms = [activity.title, activity.address, destination, activity.kind, activity.note]
    .map((term) => term?.trim())
    .filter((term): term is string => Boolean(term && term.length > 0));
  const searchQuery = searchTerms.join(" ");

  useEffect(() => {
    if (!searchQuery) {
      setPreviewUrls([]);
      return;
    }

    let cancelled = false;

    fetchActivityPhotos(searchQuery, destination).then((photos) => {
      if (!cancelled) {
        setPreviewUrls(photos);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  const focusPayload: FocusableMarker | null = hasCoords
    ? {
        lat: activity.lat as number,
        lng: activity.lng as number,
        label: activity.title,
        address: addressLine ?? activity.address,
        photoUrl: previewUrls[0]
      }
    : null;

  const handleClick = () => {
    if (focusPayload) {
      onActivityFocus?.(focusPayload);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (!focusPayload) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivityFocus?.(focusPayload);
    }
  };

  return (
    <li
      className={`flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 ${
        focusPayload ? "cursor-pointer transition hover:border-blue-500/60" : ""
      }`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={focusPayload ? "button" : undefined}
      tabIndex={focusPayload ? 0 : undefined}
      aria-label={focusPayload ? `定位到 ${activity.title}` : undefined}
    >
      {previewUrls.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {previewUrls.slice(0, 2).map((url) => (
            <div
              key={url}
              className="h-28 w-40 flex-none overflow-hidden rounded-md border border-slate-800/60"
            >
              <Image
                src={url}
                alt={`${activity.title} 参考图片`}
                width={160}
                height={112}
                className="h-full w-full object-cover"
                unoptimized
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-100">{activity.title}</span>
        {activity.time_slot && <span className="text-xs text-slate-400">{activity.time_slot}</span>}
      </div>
      <div className="space-y-1 text-sm text-slate-400">
        {activity.note && <p>{activity.note}</p>}
        {addressLine && <p>{addressLine}</p>}
        {!activity.note && !addressLine && <p>暂无补充说明</p>}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-800/80 px-2 py-0.5 uppercase">{activity.kind}</span>
        {typeof activity.cost_estimate === "number" && (
          <span className="rounded bg-emerald-900/40 px-2 py-0.5">
            预计花费 ¥{activity.cost_estimate.toFixed(0)}
          </span>
        )}
      </div>
    </li>
  );
}

export function ItineraryTimeline({ itinerary, onActivityFocus }: ItineraryTimelineProps) {
  if (!itinerary) {
    return <p className="text-sm text-slate-400">生成行程后会显示详细日程安排。</p>;
  }

  if (itinerary.daily_plan.length === 0) {
    return <p className="text-sm text-slate-400">行程暂未包含每日安排。</p>;
  }

  return (
    <section className="space-y-6">
      {itinerary.daily_plan.map((day) => (
        <article key={day.day} className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{day.day}</h3>
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {day.activities.length} 项活动
            </span>
          </header>

          {day.activities.length === 0 ? (
            <p className="text-sm text-slate-500">暂无活动安排。</p>
          ) : (
            <ol className="space-y-3">
              {day.activities.map((activity, index) => (
                <ActivityCard
                  key={`${day.day}-${activity.title}-${index}`}
                  activity={activity}
                  destination={itinerary.destination}
                  onActivityFocus={onActivityFocus}
                />
              ))}
            </ol>
          )}
        </article>
      ))}
    </section>
  );
}
