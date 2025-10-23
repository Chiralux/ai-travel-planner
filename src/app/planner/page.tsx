"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { VoiceRecorder } from "../../../ui/components/VoiceRecorder";
import { MapView } from "../../../ui/components/MapView";
import { ItineraryTimeline } from "../../../ui/components/ItineraryTimeline";
import { usePlannerStore, mapMarkersSelector } from "../../../lib/store/usePlannerStore";
import { DestinationGallery } from "../../../ui/components/DestinationGallery";

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
    setResult
  } = usePlannerStore((state) => ({
    form: state.form,
    loading: state.loading,
    error: state.error,
    result: state.result,
    setField: state.setField,
    togglePreference: state.togglePreference,
    setLoading: state.setLoading,
    setError: state.setError,
    setResult: state.setResult
  }));
  const markers = usePlannerStore(mapMarkersSelector);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);

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

    setVoiceMessage(`语音识别结果：${trimmed}`);

    setField(
      "preferences",
      Array.from(new Set([...form.preferences, trimmed]))
    );
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
            <VoiceRecorder onText={handleVoiceText} />
            {voiceMessage && <p className="text-xs text-slate-400">{voiceMessage}</p>}
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
          {markers.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/60 p-6 text-center text-sm text-slate-400">
              <span className="text-base font-medium text-slate-300">生成行程后，将基于每日活动自动打点。</span>
              <span>填写表单并提交即可在此处浏览行程地点。</span>
            </div>
          ) : (
            <MapView markers={markers} />
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">日程时间线</h2>
              <span className="text-xs text-slate-400">按天查看详细安排</span>
            </header>
            <ItineraryTimeline itinerary={result} />
          </div>

          <DestinationGallery />
        </div>
      </section>
    </section>
  );
}
