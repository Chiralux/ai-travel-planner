"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { Activity, Itinerary } from "../../src/core/validation/itinerarySchema";

type FocusableMarker = {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
};

type ItineraryTimelineProps = {
  itinerary?: Itinerary | null;
  onActivityFocus?: (marker: FocusableMarker) => void;
  onActivitySelect?: (activityElementId: string) => void;
  onActivityUpdate?: (dayIndex: number, activityIndex: number, updates: Partial<Activity>) => void;
  onActivityNavigate?: (dayIndex: number, activityIndex: number) => void;
  navigationModeLabel?: string;
};

type ActivityEditorState = {
  key: string;
  dayIndex: number;
  activityIndex: number;
  title: string;
  timeSlot: string;
  note: string;
};

function formatConfidenceLabel(confidence?: number): string | null {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }

  const percent = Math.round(confidence * 100);
  const clamped = Math.min(Math.max(percent, 0), 100);

  return `置信度 ${clamped}%`;
}

export function ItineraryTimeline({
  itinerary,
  onActivityFocus,
  onActivitySelect,
  onActivityUpdate,
  onActivityNavigate,
  navigationModeLabel
}: ItineraryTimelineProps) {
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(() => new Set());
  const [editorState, setEditorState] = useState<ActivityEditorState | null>(null);
  const [loadingActivityKeys, setLoadingActivityKeys] = useState<Set<string>>(() => new Set());
  const canEdit = typeof onActivityUpdate === "function";
  const canNavigate = typeof onActivityNavigate === "function";

  const itineraryResetToken = useMemo(() => {
    if (!itinerary) {
      return null;
    }

    const daySummary = itinerary.daily_plan
      .map((day) => `${day.day}:${day.activities.length}`)
      .join("|");

    return `${itinerary.destination}|${itinerary.days}|${itinerary.daily_plan.length}|${daySummary}`;
  }, [itinerary]);

  useEffect(() => {
    setExpandedActivities(new Set());
    setEditorState(null);
  }, [itineraryResetToken]);

  useEffect(() => {
    if (!itinerary) {
      setLoadingActivityKeys(new Set());
      return;
    }

    const next = new Set<string>();

    for (let dayIndex = 0; dayIndex < itinerary.daily_plan.length; dayIndex += 1) {
      const day = itinerary.daily_plan[dayIndex];

      for (let activityIndex = 0; activityIndex < day.activities.length; activityIndex += 1) {
        const activity = day.activities[activityIndex];
        const key = `${day.day}-${activityIndex}`;

        if (activity.media_requests && (!Array.isArray(activity.photos) || activity.photos.length === 0)) {
          next.add(key);
        }
      }
    }

    setLoadingActivityKeys(next);
  }, [itinerary]);

  const toggleExpanded = (key: string) => {
    setExpandedActivities((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  if (!itinerary) {
    return <p className="text-sm text-slate-400">生成行程后会显示详细日程安排。</p>;
  }

  if (itinerary.daily_plan.length === 0) {
    return <p className="text-sm text-slate-400">行程暂未包含每日安排。</p>;
  }

  return (
    <section className="space-y-6">
      {itinerary.daily_plan.map((day, dayIndex) => (
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
                const activityKey = `${day.day}-${index}`;
                const elementId = `timeline-activity-${dayIndex}-${index}`;
                const isEditing = editorState?.key === activityKey;
                const isExpanded = isEditing || expandedActivities.has(activityKey);
                const confidenceLabel = formatConfidenceLabel(activity.maps_confidence);
                const addressLine = activity.address
                  ? `${activity.address}${confidenceLabel ? `（${confidenceLabel}）` : ""}`
                  : null;
                const photos: string[] = Array.isArray(activity.photos) ? activity.photos.slice(0, 2) : [];
                const isMediaPending = Boolean(activity.media_requests);
                const isMediaLoading = loadingActivityKeys.has(activityKey);
                const hasCoords = typeof activity.lat === "number" && typeof activity.lng === "number";
                const focusPayload = hasCoords
                  ? {
                      lat: activity.lat as number,
                      lng: activity.lng as number,
                      label: activity.title,
                      address: addressLine ?? activity.address
                    }
                  : null;

                const handleClick = () => {
                  if (isEditing) {
                    return;
                  }

                  if (focusPayload) {
                    onActivityFocus?.(focusPayload);
                  }
                  onActivitySelect?.(elementId);
                };

                const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
                  if (!focusPayload) {
                    return;
                  }

                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onActivityFocus?.(focusPayload);
                    onActivitySelect?.(elementId);
                  }
                };

                const handleToggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  toggleExpanded(activityKey);
                };

                const handleNavigateClick = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();

                  if (!canNavigate || !hasCoords) {
                    return;
                  }

                  onActivityNavigate?.(dayIndex, index);
                };

                const handleEditClick = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();

                  if (!canEdit) {
                    return;
                  }

                  setEditorState({
                    key: activityKey,
                    dayIndex,
                    activityIndex: index,
                    title: activity.title,
                    timeSlot: activity.time_slot ?? "",
                    note: activity.note ?? ""
                  });
                  setExpandedActivities((current) => {
                    const next = new Set(current);
                    next.add(activityKey);
                    return next;
                  });
                };

                const handleEditorChange = (
                  field: "title" | "timeSlot" | "note",
                  event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
                ) => {
                  setEditorState((current) => {
                    if (!current || current.key !== activityKey) {
                      return current;
                    }

                    return {
                      ...current,
                      [field]: event.target.value
                    };
                  });
                };

                const handleCancelEdit = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  setEditorState(null);
                };

                const handleSaveEdit = (event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();

                  if (!canEdit || !editorState || editorState.key !== activityKey) {
                    return;
                  }

                  const trimmedTitle = editorState.title.trim();

                  if (!trimmedTitle) {
                    if (typeof window !== "undefined") {
                      window.alert("活动标题不能为空。请填写一个标题后再保存。");
                    }
                    return;
                  }

                  const updates: Partial<Activity> = {
                    title: trimmedTitle,
                    time_slot: editorState.timeSlot.trim() || undefined,
                    note: editorState.note.trim() || undefined
                  };

                  onActivityUpdate?.(editorState.dayIndex, editorState.activityIndex, updates);
                  setEditorState(null);
                };

                return (
                  <li
                    key={`${day.day}-${activity.title}-${index}`}
                    id={elementId}
                    className={`flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${focusPayload ? "cursor-pointer transition hover:border-blue-500/60" : ""}`}
                    onClick={!isEditing ? handleClick : undefined}
                    onKeyDown={!isEditing ? handleKeyDown : undefined}
                    role={!isEditing && focusPayload ? "button" : undefined}
                    tabIndex={!isEditing && focusPayload ? 0 : undefined}
                    aria-label={!isEditing && focusPayload ? `定位到 ${activity.title}` : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-100">{activity.title}</span>
                        {activity.time_slot && (
                          <span className="text-xs text-slate-400">{activity.time_slot}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {typeof activity.cost_estimate === "number" && (
                          <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200">
                            ¥{activity.cost_estimate.toFixed(0)}
                          </span>
                        )}
                        {canEdit && isEditing ? (
                          <>
                            <button
                              type="button"
                              className="rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 transition hover:bg-emerald-500/20"
                              onClick={handleSaveEdit}
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition hover:border-red-500 hover:text-red-300"
                              onClick={handleCancelEdit}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                              onClick={handleToggleExpanded}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? "收起详情" : "查看详情"}
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                                onClick={handleEditClick}
                              >
                                编辑
                              </button>
                            )}
                            {canNavigate && (
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 text-xs transition ${
                                  hasCoords
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                    : "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                                }`}
                                onClick={handleNavigateClick}
                                disabled={!hasCoords}
                                title={hasCoords ? "使用地图导航" : "当前活动缺少坐标"}
                              >
                                {navigationModeLabel ? `导航（${navigationModeLabel}）` : "导航"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded bg-slate-800/80 px-2 py-0.5 uppercase">{activity.kind}</span>
                      {confidenceLabel && (
                        <span className="rounded bg-slate-800/60 px-2 py-0.5">{confidenceLabel}</span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 space-y-2 text-sm text-slate-400">
                        {isEditing ? (
                          <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
                            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                              活动标题
                              <input
                                type="text"
                                value={editorState?.title ?? ""}
                                onChange={(event) => handleEditorChange("title", event)}
                                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                              时间段（可选）
                              <input
                                type="text"
                                value={editorState?.timeSlot ?? ""}
                                onChange={(event) => handleEditorChange("timeSlot", event)}
                                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                              备注（可选）
                              <textarea
                                value={editorState?.note ?? ""}
                                onChange={(event) => handleEditorChange("note", event)}
                                className="min-h-[96px] resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                              />
                            </label>
                          </div>
                        ) : (
                          <>
                            {photos.length > 0 && (
                              <div className="flex gap-2">
                                {photos.map((photo, photoIndex) => (
                                  <div
                                    key={`${day.day}-${activity.title}-photo-${photoIndex}`}
                                    className="h-20 w-32 overflow-hidden rounded-md border border-slate-800/60 bg-slate-900/80"
                                  >
                                    <img
                                      src={photo}
                                      alt={`${activity.title} 参考图`}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                            {photos.length === 0 && isMediaLoading && (
                              <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-700/70 bg-slate-900/60 px-3 py-4 text-xs text-slate-400">
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" aria-hidden="true" />
                                正在为该活动加载参考图片…
                              </div>
                            )}
                            {activity.note && <p>{activity.note}</p>}
                            {addressLine && <p>{addressLine}</p>}
                            {!activity.note && !addressLine && photos.length === 0 && !isMediaPending && (
                              <p className="text-slate-500">暂无更多信息</p>
                            )}
                          </>
                        )}
                      </div>
                    )}
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
