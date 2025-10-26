"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentProps, FormEvent } from "react";
import { VoiceRecorder } from "../../../ui/components/VoiceRecorder";
import { MapView } from "../../../ui/components/MapView";
import { ItineraryTimeline } from "../../../ui/components/ItineraryTimeline";
import { usePlannerStore, mapMarkersSelector } from "../../../lib/store/usePlannerStore";
import { DestinationGallery } from "../../../ui/components/DestinationGallery";
import { mergeParsedInput, parseTravelInput as localParseTravelInput } from "../../core/utils/travelInputParser";

const preferenceOptions = ["美食", "文化", "户外", "亲子", "夜生活", "艺术"];

type FloatingMapOverlayProps = Pick<ComponentProps<typeof MapView>, "markers" | "focusedMarker"> & {
  onScrollToMap: () => void;
};

function FloatingMapOverlay({ markers, focusedMarker, onScrollToMap }: FloatingMapOverlayProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const element = document.createElement("div");
    element.setAttribute("data-floating-map-overlay", "true");
    element.style.position = "fixed";
    element.style.bottom = "16px";
    element.style.right = "16px";
    element.style.pointerEvents = "none";
    element.style.zIndex = "9999";

    document.body.appendChild(element);
    setContainer(element);

    return () => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    };
  }, []);

  const fallbackMarker = useMemo(() => {
    if (!markers || markers.length === 0) {
      return null;
    }

    return markers.find((marker) => {
      return Boolean(
        marker.label ||
        marker.address ||
        (Array.isArray(marker.sequenceGroup) && marker.sequenceGroup.length > 0)
      );
    }) ?? markers[0];
  }, [markers]);

  const activeMarker = focusedMarker ?? (fallbackMarker
    ? {
        lat: fallbackMarker.lat,
        lng: fallbackMarker.lng,
        label:
          fallbackMarker.label ??
          fallbackMarker.sequenceGroup?.[0]?.label ??
          fallbackMarker.sequenceLabel ??
          undefined,
        address:
          fallbackMarker.address ??
          fallbackMarker.sequenceGroup?.[0]?.address ??
          undefined
      }
    : undefined);

  const markerTitle = activeMarker?.label;
  const markerAddress = activeMarker?.address;

  if (!container) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none">
      <div className="pointer-events-auto w-[280px] max-w-[90vw] rounded-2xl border border-slate-800 bg-slate-950/80 p-2 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span className="font-medium text-slate-200">快速地图预览</span>
          <button
            type="button"
            onClick={onScrollToMap}
            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
          >
            回到地图
          </button>
        </div>
        <MapView markers={markers} focusedMarker={focusedMarker} compact showInfoWindow={false} />
        {(markerTitle || markerAddress) && (
          <div className="mt-2 rounded-xl border border-slate-800/70 bg-slate-900/70 p-2 text-xs text-slate-300">
            {markerTitle && <p className="font-medium text-slate-100">{markerTitle}</p>}
            {markerAddress && <p className="mt-1 leading-relaxed text-slate-400">{markerAddress}</p>}
          </div>
        )}
      </div>
    </div>,
    container
  );
}

export default function PlannerPage() {
  const {
    form,
    loading,
    error,
    result,
    setField,
    togglePreference,
    setLoading,
    setError,
    setResult,
    setFocusedMarker,
    focusedMarker
  } = usePlannerStore((state) => ({
    form: state.form,
    loading: state.loading,
    error: state.error,
    result: state.result,
    setField: state.setField,
    togglePreference: state.togglePreference,
    setLoading: state.setLoading,
    setError: state.setError,
    setResult: state.setResult,
    setFocusedMarker: state.setFocusedMarker,
    focusedMarker: state.focusedMarker
  }));
  const markers = usePlannerStore(mapMarkersSelector);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [smartInput, setSmartInput] = useState<string>("");
  const [smartInputMessage, setSmartInputMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [isMapVisible, setIsMapVisible] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const latestParseIdRef = useRef(0);
  const hasTriedLocateRef = useRef(false);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const knownPreferences = useMemo(
    () => Array.from(new Set([...preferenceOptions, ...form.preferences])),
    [form.preferences]
  );

  const applyParsedInput = useCallback(
    async (text: string, source: "voice" | "text") => {
      const trimmed = text.trim();

      if (!trimmed) {
        return;
      }

      const setMessage = source === "voice" ? setVoiceMessage : setSmartInputMessage;
      const parseId = ++latestParseIdRef.current;

      setParsing(true);
      setMessage(`${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}\n正在解析...`);

      const requestBody = {
        text: trimmed,
        knownPreferences
      };

      const finalize = (message: string | null) => {
        if (latestParseIdRef.current === parseId) {
          setMessage(message);
          setParsing(false);
        }
      };

      try {
        const response = await fetch("/api/travel-input", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        const json = await response.json();

        let parsed = json?.ok ? (json.data as ReturnType<typeof localParseTravelInput> | null) : null;

        if (!parsed) {
          parsed = localParseTravelInput(trimmed, { knownPreferences });
        }

        if (!parsed) {
          finalize(`${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}\n未能识别出有效的行程信息，请尝试描述目的地、天数或预算。`);
          return;
        }

        mergeParsedInput({ form, setField }, parsed);

        const summaries: string[] = [];
        if (parsed.destination) {
          summaries.push(`目的地 ${parsed.destination}`);
        }
        if (parsed.days) {
          summaries.push(`天数 ${parsed.days} 天`);
        }
        if (typeof parsed.budget === "number") {
          summaries.push(`预算约 ¥${parsed.budget}`);
        }
        if (parsed.partySize) {
          summaries.push(`同行 ${parsed.partySize} 人`);
        }
        if (parsed.preferences?.length) {
          summaries.push(`偏好 ${parsed.preferences.join("、")}`);
        }
        if (parsed.origin) {
          summaries.push(`出发地 ${parsed.origin}`);
        }

        const feedback = summaries.length
          ? `${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}\n已识别：${summaries.join("，")}`
          : `${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}`;

        finalize(feedback);
      } catch (error) {
        console.error("Failed to parse travel input", error);
        const fallback = localParseTravelInput(trimmed, { knownPreferences });

        if (!fallback) {
          finalize(`${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}\n解析失败，请稍后重试。`);
          return;
        }

        mergeParsedInput({ form, setField }, fallback);

        const summaries: string[] = [];
        if (fallback.destination) {
          summaries.push(`目的地 ${fallback.destination}`);
        }
        if (fallback.days) {
          summaries.push(`天数 ${fallback.days} 天`);
        }
        if (typeof fallback.budget === "number") {
          summaries.push(`预算约 ¥${fallback.budget}`);
        }
        if (fallback.partySize) {
          summaries.push(`同行 ${fallback.partySize} 人`);
        }
        if (fallback.preferences?.length) {
          summaries.push(`偏好 ${fallback.preferences.join("、")}`);
        }
        if (fallback.origin) {
          summaries.push(`出发地 ${fallback.origin}`);
        }

        const feedback = summaries.length
          ? `${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}\n已识别（本地解析）：${summaries.join("，")}`
          : `${source === "voice" ? "语音识别结果" : "解析内容"}：${trimmed}`;

        finalize(feedback);
      }
    },
    [form, knownPreferences, mergeParsedInput, setField]
  );

  const handleActivityFocus = useCallback(
    (marker: { lat: number; lng: number; label?: string; address?: string }) => {
      setFocusedMarker(marker);
    },
    [setFocusedMarker]
  );

  const detectCurrentOrigin = useCallback(async () => {
    if (locating) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("当前浏览器不支持定位，您可以手动填写出发地。");
      return;
    }

    setLocating(true);
    setLocationStatus("正在定位当前出发地...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        setField("originCoords", { lat: latitude, lng: longitude });

        try {
          const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
          const response = await fetch(`/api/geocode/reverse?${params.toString()}`);
          const json = await response.json();

          if (response.ok && json.ok) {
            const label = json.data?.label ?? "当前位置";
            setField("origin", label);
            setLocationStatus(`已定位：${label}`);
          } else {
            const fallbackLabel = `当前位置 (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
            setField("origin", fallbackLabel);
            setLocationStatus("定位成功，但无法识别城市名称，可手动调整。");
          }
        } catch (error) {
          console.error("Failed to reverse geocode", error);
          const fallbackLabel = `当前位置 (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
          setField("origin", fallbackLabel);
          setLocationStatus("定位成功，但地理名称获取失败，可手动调整。");
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        console.warn("Geolocation failed", error);
        setLocating(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationStatus("未获得定位权限，请手动填写出发地。");
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationStatus("无法获取位置信息，请检查定位服务。");
            break;
          case error.TIMEOUT:
            setLocationStatus("定位超时，请重试或手动填写。");
            break;
          default:
            setLocationStatus("定位失败，请重试或手动填写出发地。");
        }
      },
      { enableHighAccuracy: false, timeout: 1000 * 15, maximumAge: 1000 * 60 * 5 }
    );
  }, [locating, setField]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const element = mapSectionRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsMapVisible(entry?.isIntersecting ?? true);
      },
      { threshold: 0.2 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (hasTriedLocateRef.current) {
      return;
    }
    hasTriedLocateRef.current = true;

    if (form.origin && form.origin.trim().length > 0) {
      setLocationStatus(`出发地：${form.origin}`);
      return;
    }

    void detectCurrentOrigin();
  }, [detectCurrentOrigin, form.origin]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.destination.trim()) {
      setError("目的地不能为空。");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const payload = {
      destination: form.destination.trim(),
      days: Number(form.days) || 1,
      budget: form.budget,
      partySize: form.partySize,
      preferences: form.preferences,
      origin: form.origin?.trim() || undefined,
      originCoords: form.originCoords
    };

    try {
      const response = await fetch("/api/itineraries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (response.status >= 500) {
        window.alert("生成失败，请重试。");
      }

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json?.error ?? "生成行程失败，请稍后再试。");
      }

      setResult(json.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成行程失败，请检查网络后重试。";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceToggle = (value: string) => {
    togglePreference(value);
  };

  const handleVoiceText = (text: string) => {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    void applyParsedInput(trimmed, "voice");
  };

  const handleSmartInputParse = () => {
    const trimmed = smartInput.trim();

    if (!trimmed) {
      setSmartInputMessage("请输入自然语言描述，例如：我想去日本，5 天，预算 1 万元，喜欢美食和动漫，带孩子。");
      return;
    }

    void applyParsedInput(trimmed, "text");
  };

  const handleScrollToMap = useCallback(() => {
    mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const shouldShowFloatingMap = isClient && !isMapVisible && markers.length > 0;

  const floatingMapOverlay = shouldShowFloatingMap ? (
    <FloatingMapOverlay
      markers={markers}
      focusedMarker={focusedMarker ?? undefined}
      onScrollToMap={handleScrollToMap}
    />
  ) : null;

  return (
    <section className="flex flex-col gap-10">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-4 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
          AI Powered
        </span>
        <h1 className="text-4xl font-semibold text-white md:text-5xl">行程规划助手</h1>
        <p className="max-w-2xl text-slate-300">
          输入目的地、行程偏好与预算，AI 将生成每日行程安排。也可以使用语音补充灵感，随后你可以在交互地图与时间线上探索每个地点。
        </p>
      </header>

      <form
        className="grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg md:grid-cols-2"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <span className="text-sm font-medium text-slate-200">快捷输入（语音 / 文字）</span>
            <p className="text-xs text-slate-400">描述旅行需求，系统会自动填充目的地、天数、预算、同行人数与偏好。</p>
            <textarea
              value={smartInput}
              onChange={(event) => {
                setSmartInput(event.target.value);
                setSmartInputMessage(null);
              }}
              className="h-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="例如：我想去日本东京玩 5 天，预算 1 万元，带孩子，喜欢美食和动漫"
            />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSmartInputParse}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white transition hover:bg-slate-700 disabled:opacity-60"
                  disabled={parsing}
                >
                  {parsing ? "解析中..." : "解析文字描述"}
                </button>
                <VoiceRecorder onText={handleVoiceText} />
              </div>
              {smartInputMessage && (
                <p className="whitespace-pre-line text-xs text-slate-400">{smartInputMessage}</p>
              )}
            </div>
            {voiceMessage && !smartInputMessage && (
              <p className="whitespace-pre-line text-xs text-slate-400">{voiceMessage}</p>
            )}
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">出发地</span>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={form.origin ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setField("origin", value);
                  setLocationStatus(value.trim().length > 0 ? `出发地：${value.trim()}` : "您可以定位或填写出发地");
                }}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                placeholder="定位或手动填写出发地"
              />
              <button
                type="button"
                onClick={() => {
                  void detectCurrentOrigin();
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                disabled={locating}
              >
                {locating ? "定位中..." : "重新定位"}
              </button>
            </div>
            {locationStatus && <p className="text-xs text-slate-400">{locationStatus}</p>}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">目的地</span>
            <input
              type="text"
              value={form.destination}
              onChange={(event) => setField("destination", event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="例如：上海"
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">行程天数</span>
            <input
              type="number"
              min={1}
              value={form.days}
              onChange={(event) => setField("days", Math.max(1, Number(event.target.value) || 1))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">预算（元）</span>
            <input
              type="number"
              min={0}
              value={form.budget ?? ""}
              onChange={(event) =>
                setField("budget", event.target.value ? Math.max(0, Number(event.target.value)) : undefined)
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="可选"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">同行人数</span>
            <input
              type="number"
              min={1}
              value={form.partySize ?? ""}
              onChange={(event) =>
                setField("partySize", event.target.value ? Math.max(1, Number(event.target.value)) : undefined)
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="可选"
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">偏好标签</span>
            <div className="flex flex-wrap gap-2">
              {preferenceOptions.map((option) => (
                <label key={option} className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-blue-500"
                    checked={form.preferences.includes(option)}
                    onChange={() => handlePreferenceToggle(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {form.preferences.length > 0 && (
              <div className="text-xs text-slate-400">
                已选择：{form.preferences.join("、")}
              </div>
            )}
          </div>

        </div>

        <div className="flex flex-col justify-between gap-4">
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-500 px-6 py-3 text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "生成中..." : "生成行程"}
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {result ? (
            <div className="space-y-3 text-sm text-slate-300">
              {form.origin && (
                <div>
                  <span className="font-semibold text-white">出发地：</span>
                  {form.origin}
                </div>
              )}
              <div>
                <span className="font-semibold text-white">目的地：</span>
                {result.destination}（共 {result.days} 天）
              </div>
              {typeof result.budget_estimate === "number" && (
                <div>
                  <span className="font-semibold text-white">预算估计：</span>¥{result.budget_estimate.toFixed(0)}
                </div>
              )}
              {result.preference_tags.length > 0 && (
                <div>
                  <span className="font-semibold text-white">偏好标签：</span>
                  {result.preference_tags.join("、")}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">提交后将在此展示摘要。</p>
          )}
        </div>
      </form>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div ref={mapSectionRef} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
          <header className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">互动地图</h2>
            <span className="text-xs text-slate-400">拖动缩放以查看每日地点</span>
          </header>
          <div className="relative h-80">
            <MapView markers={markers} focusedMarker={focusedMarker ?? undefined} />
          </div>
          {markers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/60 p-4 text-center text-sm text-slate-400">
              <p className="text-base font-medium text-slate-300">填写表单并生成行程后，将基于每日活动自动打点。</p>
              <p>当前展示的是底图，你仍然可以拖动或缩放查看城市概览。</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">日程时间线</h2>
              <span className="text-xs text-slate-400">按天查看详细安排</span>
            </header>
            <ItineraryTimeline itinerary={result} onActivityFocus={handleActivityFocus} />
          </div>

          <DestinationGallery />
        </div>
      </section>
      {floatingMapOverlay}
    </section>
  );
}
