"use client";

import type { Itinerary } from "../../src/core/validation/itinerarySchema";
import type { KeyboardEvent } from "react";

type FocusableMarker = {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
};

type ItineraryTimelineProps = {
  itinerary?: Itinerary | null;
  onActivityFocus?: (marker: FocusableMarker) => void;
};

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
            <p className="text-sm text-slate-500">暂无活动安排。</p>) : (
            <ol className="space-y-3">
              {day.activities.map((activity, index) => {
                const hasCoords = typeof activity.lat === "number" && typeof activity.lng === "number";
                const focusPayload = hasCoords
                  ? {
                      lat: activity.lat as number,
                      lng: activity.lng as number,
                      label: activity.title,
                      address: activity.address
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
                    key={`${day.day}-${activity.title}-${index}`}
                    className={`flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 ${focusPayload ? "cursor-pointer transition hover:border-blue-500/60" : ""}`}
                    onClick={handleClick}
                    onKeyDown={handleKeyDown}
                    role={focusPayload ? "button" : undefined}
                    tabIndex={focusPayload ? 0 : undefined}
                    aria-label={focusPayload ? `定位到 ${activity.title}` : undefined}
                  >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-100">{activity.title}</span>
                    {activity.time_slot && (
                      <span className="text-xs text-slate-400">{activity.time_slot}</span>
                    )}
                  </div>
                  <div className="text-sm text-slate-400">
                    {activity.note ?? activity.address ?? "暂无补充说明"}
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
              })}
            </ol>
          )}
        </article>
      ))}
    </section>
  );
}
