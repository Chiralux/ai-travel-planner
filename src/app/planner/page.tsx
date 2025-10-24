"use client";

import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { VoiceRecorder } from "../../../ui/components/VoiceRecorder";
import { MapView } from "../../../ui/components/MapView";
import { ItineraryTimeline } from "../../../ui/components/ItineraryTimeline";
import { usePlannerStore, mapMarkersSelector } from "../../../lib/store/usePlannerStore";
import { DestinationGallery } from "../../../ui/components/DestinationGallery";
import { mergeParsedInput, parseTravelInput } from "../../core/utils/travelInputParser";

const preferenceOptions = ["美食", "文化", "户外", "亲子", "夜生活", "艺术"];

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

  const knownPreferences = useMemo(
    () => Array.from(new Set([...preferenceOptions, ...form.preferences])),
    [form.preferences]
  );

  const applyParsedInput = useCallback(
    (text: string, source: "voice" | "text") => {
      const parsed = parseTravelInput(text, { knownPreferences });

      if (!parsed) {
        const base = source === "voice" ? "语音识别结果：" : "解析内容：";
        const feedback = `${base}${text}\n未能识别出有效的行程信息，请尝试描述目的地、天数或预算。`;
        if (source === "voice") {
          setVoiceMessage(feedback);
        } else {
          setSmartInputMessage(feedback);
        }
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

      const feedback = summaries.length
        ? `${source === "voice" ? "语音识别结果" : "解析内容"}：${text}\n已识别：${summaries.join("，")}`
        : `${source === "voice" ? "语音识别结果" : "解析内容"}：${text}`;

      if (source === "voice") {
        setVoiceMessage(feedback);
      } else {
        setSmartInputMessage(feedback);
      }
    },
    [form, knownPreferences, setField]
  );

  const handleActivityFocus = useCallback(
    (marker: { lat: number; lng: number; label?: string; address?: string }) => {
      setFocusedMarker(marker);
    },
    [setFocusedMarker]
  );

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
      preferences: form.preferences
    };

    try {
      const response = await fetch("/api/itineraries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

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

    applyParsedInput(trimmed, "voice");
  };

  const handleSmartInputParse = () => {
    const trimmed = smartInput.trim();

    if (!trimmed) {
      setSmartInputMessage("请输入自然语言描述，例如：我想去日本，5 天，预算 1 万元，喜欢美食和动漫，带孩子。");
      return;
    }

    applyParsedInput(trimmed, "text");
  };

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
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white transition hover:bg-slate-700"
                >
                  解析文字描述
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

          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <span className="text-sm font-medium text-slate-200">语音偏好输入</span>
            <p className="text-xs text-slate-400">语音内容同样会尝试解析目的地、天数、预算、同行人数与偏好。</p>
            <VoiceRecorder onText={handleVoiceText} />
            {voiceMessage && (
              <p className="whitespace-pre-line text-xs text-slate-400">{voiceMessage}</p>
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
        <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
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
    </section>
  );
}
