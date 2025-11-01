"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentProps, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { VoiceRecorder } from "../../../ui/components/VoiceRecorder";
import { MapView } from "../../../ui/components/MapView";
import { ItineraryTimeline } from "../../../ui/components/ItineraryTimeline";
import {
  usePlannerStore,
  mapMarkersSelector,
  type PlannerForm,
  type PlannerRoute
} from "../../../lib/store/usePlannerStore";
import { mergeParsedInput, parseTravelInput as localParseTravelInput } from "../../core/utils/travelInputParser";
import { useSupabaseAuth } from "../../lib/supabase/AuthProvider";

const preferenceOptions = ["缇庨", "鏂囧寲", "鎴峰", "浜插瓙", "澶滅敓娲?, "鑹烘湳"];

type PlanSummary = {
  id: string;
  title: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

type FloatingMapOverlayProps = Pick<ComponentProps<typeof MapView>, "markers" | "focusedMarker" | "route"> & {
  onScrollToMap: () => void;
};

const NAVIGATION_MODE_LABELS: Record<PlannerRoute["mode"], string> = {
  driving: "椹捐溅",
  walking: "姝ヨ",
  cycling: "楠戣",
  transit: "鍏氦/鍦伴搧"
};

const NAVIGATION_MODE_SEQUENCE: PlannerRoute["mode"][] = [
  "driving",
  "walking",
  "cycling",
  "transit"
];

function FloatingMapOverlay({ markers, focusedMarker, route, onScrollToMap }: FloatingMapOverlayProps) {
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
    element.style.zIndex = "9999";

    document.body.appendChild(element);
    setContainer(element);

    return () => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    };
  }, []);

  if (!container) {
    return null;
  }

  return createPortal(
    <div>
      <div className="w-[280px] max-w-[90vw] rounded-2xl border border-slate-800 bg-slate-950/80 p-2 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span className="font-medium text-slate-200">蹇€熷湴鍥鹃瑙?/span>
          <button
            type="button"
            onClick={onScrollToMap}
            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
          >
            鍥炲埌鍦板浘
          </button>
        </div>
        <MapView markers={markers} focusedMarker={focusedMarker} compact showInfoWindow={false} route={route} />
      </div>
    </div>,
    container
  );
}

function formatDistance(meters: number | undefined): string {
  if (!Number.isFinite(meters)) {
    return "-";
  }

  const value = meters as number;

  if (value >= 1000) {
    const kilometres = value / 1000;
    const formatted = kilometres >= 10 ? Math.round(kilometres).toString() : kilometres.toFixed(1);
    return `${formatted} 鍏噷`;
  }

  return `${Math.round(value)} 绫砢;
}

function formatDuration(seconds: number | undefined): string {
  if (!Number.isFinite(seconds)) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.round(seconds as number));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} 灏忔椂${minutes > 0 ? ` ${minutes} 鍒哷 : ""}`;
  }

  if (minutes > 0) {
    return `${minutes} 鍒?{remainingSeconds > 0 ? ` ${remainingSeconds} 绉抈 : ""}`;
  }

  return `${remainingSeconds} 绉抈;
}

export default function PlannerPage() {
  const router = useRouter();
  const { session, accessToken, loading: authLoading } = useSupabaseAuth();

  useEffect(() => {
    if (!authLoading && !session) {
      router.replace("/auth");
    }
  }, [authLoading, session, router]);

  if (authLoading) {
    return (
      <p className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 text-center text-slate-300">
        姝ｅ湪楠岃瘉鐧诲綍鐘舵€?..
      </p>
    );
  }

  if (!session) {
    return (
      <p className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 text-center text-slate-300">
        闇€瑕佺櫥褰曞悗鎵嶈兘浣跨敤琛岀▼瑙勫垝鍔熻兘锛屾鍦ㄨ烦杞?..
      </p>
    );
  }

  return <PlannerContent accessToken={accessToken} />;
}

type PlannerContentProps = {
  accessToken: string | null;
};

function PlannerContent({ accessToken }: PlannerContentProps) {
  const {
    form,
    loading,
    error,
    result,
    setForm,
    setField,
    togglePreference,
    setLoading,
    setError,
    setResult,
    setFocusedMarker,
    focusedMarker,
    goBackToPreviousMarker,
    focusHistory,
    hydrateFromPlan,
    updateActivity,
    activeRoute,
    setRoute,
    clearRoute
  } = usePlannerStore((state) => ({
    form: state.form,
    loading: state.loading,
    error: state.error,
    result: state.result,
    setForm: state.setForm,
    setField: state.setField,
    togglePreference: state.togglePreference,
    setLoading: state.setLoading,
    setError: state.setError,
    setResult: state.setResult,
    setFocusedMarker: state.setFocusedMarker,
    focusedMarker: state.focusedMarker,
    goBackToPreviousMarker: state.goBackToPreviousMarker,
    focusHistory: state.focusHistory,
    hydrateFromPlan: state.hydrateFromPlan,
    updateActivity: state.updateActivity,
    activeRoute: state.activeRoute,
    setRoute: state.setRoute,
    clearRoute: state.clearRoute
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
  const [lastActivityElementId, setLastActivityElementId] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [planSummary, setPlanSummary] = useState("");
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<string | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationMode, setNavigationMode] = useState<PlannerRoute["mode"]>("driving");
  const latestParseIdRef = useRef(0);
  const hasTriedLocateRef = useRef(false);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);
  const latestNavigationAttemptRef = useRef(0);
  const navigationModeLabel = NAVIGATION_MODE_LABELS[navigationMode];

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
  const prefix = source === "voice" ? "璇煶璇嗗埆" : "鏂囧瓧瑙ｆ瀽";
      const parseId = ++latestParseIdRef.current;

      setParsing(true);
  setMessage(`${prefix}锛氭鍦ㄨВ鏋?..`);

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
        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };

        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetch("/api/travel-input", {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody)
        });

        const json = await response.json();

        let parsed = json?.ok ? (json.data as ReturnType<typeof localParseTravelInput> | null) : null;

        if (!parsed) {
          parsed = localParseTravelInput(trimmed, { knownPreferences });
        }

        if (!parsed) {
          finalize(`${prefix}锛氭湭鑳借瘑鍒嚭鏈夋晥鐨勮绋嬩俊鎭紝璇峰皾璇曟弿杩扮洰鐨勫湴銆佸ぉ鏁版垨棰勭畻銆俙);
          return;
        }

  mergeParsedInput({ form, setField }, parsed, { mergePreferences: false });

        const summaries: string[] = [];
        if (parsed.destination) {
          summaries.push(`鐩殑鍦?${parsed.destination}`);
        }
        if (parsed.days) {
          summaries.push(`澶╂暟 ${parsed.days} 澶ー);
        }
        if (typeof parsed.budget === "number") {
          summaries.push(`棰勭畻绾?楼${parsed.budget}`);
        }
        if (parsed.partySize) {
          summaries.push(`鍚岃 ${parsed.partySize} 浜篳);
        }
        if (parsed.preferences?.length) {
          summaries.push(`鍋忓ソ ${parsed.preferences.join("銆?)}`);
        }
        if (parsed.origin) {
          summaries.push(`鍑哄彂鍦?${parsed.origin}`);
        }

        const feedback = summaries.length
          ? `${prefix}鎴愬姛锛?{summaries.join("锛?)}`
          : `${prefix}鎴愬姛锛氬凡鎺ユ敹杈撳叆銆俙;

        finalize(feedback);
      } catch (error) {
        console.error("Failed to parse travel input", error);
        const fallback = localParseTravelInput(trimmed, { knownPreferences });

        if (!fallback) {
          finalize(`${prefix}锛氳В鏋愬け璐ワ紝璇风◢鍚庨噸璇曘€俙);
          return;
        }

  mergeParsedInput({ form, setField }, fallback, { mergePreferences: false });

        const summaries: string[] = [];
        if (fallback.destination) {
          summaries.push(`鐩殑鍦?${fallback.destination}`);
        }
        if (fallback.days) {
          summaries.push(`澶╂暟 ${fallback.days} 澶ー);
        }
        if (typeof fallback.budget === "number") {
          summaries.push(`棰勭畻绾?楼${fallback.budget}`);
        }
        if (fallback.partySize) {
          summaries.push(`鍚岃 ${fallback.partySize} 浜篳);
        }
        if (fallback.preferences?.length) {
          summaries.push(`鍋忓ソ ${fallback.preferences.join("銆?)}`);
        }
        if (fallback.origin) {
          summaries.push(`鍑哄彂鍦?${fallback.origin}`);
        }

        const feedback = summaries.length
          ? `${prefix}鎴愬姛锛堟湰鍦拌В鏋愶級锛?{summaries.join("锛?)}`
          : `${prefix}鎴愬姛锛氬凡鎺ユ敹杈撳叆銆俙;

        finalize(feedback);
      }
    },
    [form, knownPreferences, mergeParsedInput, setField, accessToken]
  );

  const handleActivityFocus = useCallback(
    (marker: { lat: number; lng: number; label?: string; address?: string }) => {
      setFocusedMarker(marker);
    },
    [setFocusedMarker]
  );

  const handleActivitySelect = useCallback((elementId: string) => {
    setLastActivityElementId(elementId);
  }, []);

  const detectCurrentOrigin = useCallback(
    (options?: { updateEmptyOrigin?: boolean }) => {
      if (locating) {
        return;
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setLocationStatus("褰撳墠娴忚鍣ㄤ笉鏀寔瀹氫綅锛屾偍鍙互鎵嬪姩濉啓鍑哄彂鍦般€?);
        return;
      }

      setLocating(true);
      setLocationStatus("姝ｅ湪瀹氫綅褰撳墠鍑哄彂鍦?..");

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          const shouldUpdateOrigin = options?.updateEmptyOrigin || !form.origin?.trim();

          setField("originCoords", { lat: latitude, lng: longitude });

          try {
            const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
            const headers: Record<string, string> = {};

            if (accessToken) {
              headers.Authorization = `Bearer ${accessToken}`;
            }

            const response = await fetch(`/api/geocode/reverse?${params.toString()}`, {
              headers: Object.keys(headers).length > 0 ? headers : undefined
            });
            const json = await response.json();

            if (response.ok && json.ok) {
              const label = json.data?.label ?? "褰撳墠浣嶇疆";
              if (shouldUpdateOrigin) {
                setField("origin", label);
              }
              setLocationStatus(`宸插畾浣嶏細${label}`);
            } else {
              const fallbackLabel = `褰撳墠浣嶇疆 (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
              if (shouldUpdateOrigin) {
                setField("origin", fallbackLabel);
              }
              setLocationStatus("瀹氫綅鎴愬姛锛屼絾鏃犳硶璇嗗埆鍩庡競鍚嶇О锛屽彲鎵嬪姩璋冩暣銆?);
            }
          } catch (error) {
            console.error("Failed to reverse geocode", error);
            const fallbackLabel = `褰撳墠浣嶇疆 (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
            if (shouldUpdateOrigin) {
              setField("origin", fallbackLabel);
            }
            setLocationStatus("瀹氫綅鎴愬姛锛屼絾鍦扮悊鍚嶇О鑾峰彇澶辫触锛屽彲鎵嬪姩璋冩暣銆?);
          } finally {
            setLocating(false);
          }
        },
        (error) => {
          console.warn("Geolocation failed", error);
          setLocating(false);
          switch (error.code) {
            case error.PERMISSION_DENIED:
              setLocationStatus("鏈幏寰楀畾浣嶆潈闄愶紝璇锋墜鍔ㄥ～鍐欏嚭鍙戝湴銆?);
              break;
            case error.POSITION_UNAVAILABLE:
              setLocationStatus("鏃犳硶鑾峰彇浣嶇疆淇℃伅锛岃妫€鏌ュ畾浣嶆湇鍔°€?);
              break;
            case error.TIMEOUT:
              setLocationStatus("瀹氫綅瓒呮椂锛岃閲嶈瘯鎴栨墜鍔ㄥ～鍐欍€?);
              break;
            default:
              setLocationStatus("瀹氫綅澶辫触锛岃閲嶈瘯鎴栨墜鍔ㄥ～鍐欏嚭鍙戝湴銆?);
          }
        },
        { enableHighAccuracy: false, timeout: 1000 * 15, maximumAge: 1000 * 60 * 5 }
      );
    },
    [form.origin, locating, setField, setLocationStatus, accessToken]
  );

  const clearPrimaryFormFields = useCallback(() => {
    setForm({
      ...form,
      origin: "",
      destination: "",
      days: 1,
      budget: undefined,
      partySize: undefined,
      originCoords: undefined,
      preferences: []
    });
    setSmartInput("");
    setSmartInputMessage(null);
    setVoiceMessage(null);
    setLocationStatus(null);
    detectCurrentOrigin({ updateEmptyOrigin: true });
  }, [
    detectCurrentOrigin,
    form,
    setForm,
    setLocationStatus,
    setSmartInput,
    setSmartInputMessage,
    setVoiceMessage
  ]);

  const handleVoiceText = (text: string) => {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    clearPrimaryFormFields();
    void applyParsedInput(trimmed, "voice");
  };

  const handleSmartInputParse = () => {
    clearPrimaryFormFields();
    const trimmed = smartInput.trim();

    if (!trimmed) {
      setSmartInputMessage("璇疯緭鍏ヨ嚜鐒惰瑷€鎻忚堪锛屼緥濡傦細鎴戜滑涓変釜浜哄甫浜?涓囧潡閽辨兂鍘昏タ瀹夌帺5 澶╋紝鍠滄缇庨鍜屾埛澶栨椿鍔ㄣ€?);
      return;
    }

    void applyParsedInput(trimmed, "text");
  };

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    setLastActivityElementId(null);
    setNavigationStatus(null);
    setNavigationLoading(false);
  }, [result]);

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
      setLocationStatus(`鍑哄彂鍦帮細${form.origin}`);
      return;
    }

    void detectCurrentOrigin();
  }, [detectCurrentOrigin, form.origin]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.destination.trim()) {
      setError("鐩殑鍦颁笉鑳戒负绌恒€?);
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
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch("/api/itineraries", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (response.status >= 500) {
        window.alert("鐢熸垚澶辫触锛岃閲嶈瘯銆?);
      }

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json?.error ?? "鐢熸垚琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?);
      }

      setResult(json.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "鐢熸垚琛岀▼澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceToggle = (value: string) => {
    togglePreference(value);
  };

  const fetchPlans = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setLoadingPlans(true);
    setPlansError(null);

    try {
      const response = await fetch(`/api/plans`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json?.error ?? "鑾峰彇浜戠琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?);
      }

      setPlans(json.data?.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "鑾峰彇浜戠琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
      setPlansError(message);
    } finally {
      setLoadingPlans(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (showPlans) {
      void fetchPlans();
    }
  }, [showPlans, fetchPlans]);

  const handleSavePlan = useCallback(async () => {
    if (!accessToken) {
      window.alert("璇峰厛鐧诲綍鍚庡啀淇濆瓨琛岀▼銆?);
      return;
    }

    if (!result) {
      window.alert("鐢熸垚琛岀▼鍚庢墠鑳戒繚瀛樸€?);
      return;
    }

    const title = planTitle.trim() || `${form.destination || "鏈懡鍚嶇洰鐨勫湴"} 琛岀▼`;
    const payload = {
      title,
      summary: planSummary.trim() || undefined,
      form: {
        destination: form.destination,
        days: form.days,
        budget: form.budget,
        partySize: form.partySize,
        preferences: form.preferences,
        origin: form.origin,
        originCoords: form.originCoords ?? undefined
      },
      itinerary: result
    };

    const endpoint = activePlanId ? `/api/plans/${activePlanId}` : "/api/plans";
    const method = activePlanId ? "PUT" : "POST";

    setSavingPlan(true);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json?.error ?? "淇濆瓨琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?);
      }

      const data = json.data as PlanSummary;
      setActivePlanId(data.id);
      setPlanTitle(data.title ?? title);
      setPlanSummary(data.summary ?? "");
      window.alert(activePlanId ? "琛岀▼宸叉洿鏂般€? : "琛岀▼宸蹭繚瀛樺埌浜戠銆?);
      setShowPlans(true);
      void fetchPlans();
    } catch (error) {
      const message = error instanceof Error ? error.message : "淇濆瓨琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
      window.alert(message);
    } finally {
      setSavingPlan(false);
    }
  }, [accessToken, result, planTitle, planSummary, form, fetchPlans, activePlanId]);

  const handleLoadPlan = useCallback(
    async (planId: string) => {
      if (!accessToken) {
        return;
      }

      setPlansError(null);
      setLoadingPlans(true);

      try {
        const response = await fetch(`/api/plans/${planId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        const json = await response.json();

        if (!response.ok || !json.ok) {
          throw new Error(json?.error ?? "鍔犺浇琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?);
        }

        const data = json.data as {
          id: string;
          form: PlannerForm;
          itinerary: NonNullable<typeof result>;
          title?: string;
          summary?: string | null;
        };

        hydrateFromPlan({ form: data.form, itinerary: data.itinerary });
        setActivePlanId(data.id);
        setPlanTitle(data.title ?? "");
        setPlanSummary(data.summary ?? "");
        window.alert("宸插姞杞戒簯绔绋嬨€?);
        setShowPlans(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "鍔犺浇琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
        setPlansError(message);
      } finally {
        setLoadingPlans(false);
      }
    },
    [accessToken, hydrateFromPlan, form, result]
  );

  const handleDeletePlan = useCallback(
    async (planId: string) => {
      if (!accessToken) {
        window.alert("璇峰厛鐧诲綍鍚庡啀鍒犻櫎琛岀▼銆?);
        return;
      }

      if (typeof window !== "undefined" && !window.confirm("纭畾瑕佸垹闄よ繖涓簯绔绋嬪悧锛熷垹闄ゅ悗鏃犳硶鎭㈠銆?)) {
        return;
      }

      try {
        setPlansError(null);
        const response = await fetch(`/api/plans/${planId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        const json = await response.json();

        if (!response.ok || !json.ok) {
          throw new Error(json?.error ?? "鍒犻櫎琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?);
        }

        setPlans((current) => current.filter((plan) => plan.id !== planId));

        if (planId === activePlanId) {
          setActivePlanId(null);
          setPlanTitle("");
          setPlanSummary("");
        }

        window.alert("浜戠琛岀▼宸插垹闄ゃ€?);
        void fetchPlans();
      } catch (error) {
        const message = error instanceof Error ? error.message : "鍒犻櫎琛岀▼澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
        window.alert(message);
        setPlansError(message);
      }
    },
    [accessToken, activePlanId, fetchPlans]
  );

  const handleScrollToMap = useCallback(() => {
    if (!mapSectionRef.current) {
      return;
    }

    mapSectionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });

    // Optimistically hide the floating map so the main map becomes the focus immediately.
    setIsMapVisible(true);

    // Ensure the section gets focus for accessibility if the map supports keyboard interaction.
    if (typeof mapSectionRef.current.focus === "function" && typeof window !== "undefined") {
      // Delay focus slightly to align with scroll behavior.
      window.requestAnimationFrame(() => {
        mapSectionRef.current?.focus?.({ preventScroll: true });
      });
    }
  }, [setIsMapVisible]);

  const handleScrollToLastActivity = useCallback(() => {
    if (!lastActivityElementId) {
      return;
    }

    if (typeof document === "undefined") {
      return;
    }

    const target = document.getElementById(lastActivityElementId);

    if (!target) {
      setLastActivityElementId(null);
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });

    if (typeof window !== "undefined" && typeof (target as HTMLElement).focus === "function") {
      window.requestAnimationFrame(() => {
        (target as HTMLElement).focus({ preventScroll: true });
      });
    }
  }, [lastActivityElementId]);

  const handleReturnToPrevious = useCallback(() => {
    goBackToPreviousMarker();
    setIsMapVisible(true);

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        mapSectionRef.current?.focus?.({ preventScroll: true });
      });
    }
  }, [goBackToPreviousMarker, setIsMapVisible]);

  const shouldShowFloatingMap = isClient && !isMapVisible && markers.length > 0;
  const hasMarkerHistory = focusHistory.length > 0;
  const routeForMap = activeRoute ? { points: activeRoute.points } : null;
  const activeRouteModeLabel = activeRoute ? NAVIGATION_MODE_LABELS[activeRoute.mode] : null;

  const floatingMapOverlay = shouldShowFloatingMap ? (
    <FloatingMapOverlay
      markers={markers}
      focusedMarker={focusedMarker ?? undefined}
      route={routeForMap}
      onScrollToMap={handleScrollToMap}
    />
  ) : null;

  const resolveNavigationOrigin = useCallback(
    (dayIndex: number, activityIndex: number) => {
      if (!result) {
        return null;
      }

      for (let currentDayIndex = dayIndex; currentDayIndex >= 0; currentDayIndex -= 1) {
        const day = result.daily_plan[currentDayIndex];

        if (!day) {
          continue;
        }

        const startActivityIndex =
          currentDayIndex === dayIndex ? Math.min(activityIndex - 1, day.activities.length - 1) : day.activities.length - 1;

        for (let currentActivityIndex = startActivityIndex; currentActivityIndex >= 0; currentActivityIndex -= 1) {
          const candidate = day.activities[currentActivityIndex];

          if (typeof candidate?.lat === "number" && typeof candidate?.lng === "number") {
            return {
              lat: candidate.lat,
              lng: candidate.lng,
              label: candidate.title,
              address: candidate.address
            };
          }
        }
      }

      if (form.originCoords) {
        return {
          lat: form.originCoords.lat,
          lng: form.originCoords.lng,
          label: form.origin ? `鍑哄彂鍦帮細${form.origin}` : "鍑哄彂鍦?,
          address: form.origin ?? undefined
        };
      }

      return null;
    },
    [result, form.originCoords, form.origin]
  );

  const lastSuccessfulNavigationRef = useRef<{ dayIndex: number; activityIndex: number } | null>(null);

  const handleNavigateToActivity = useCallback(
    async (
      dayIndex: number,
      activityIndex: number,
      options?: { reuseExistingRequestId?: number }
    ) => {
      if (!result) {
        setNavigationStatus("璇峰厛鐢熸垚琛岀▼锛屽啀灏濊瘯瀵艰埅銆?);
        return;
      }

      const day = result.daily_plan[dayIndex];
      const activity = day?.activities?.[activityIndex];

      if (!activity) {
        setNavigationStatus("鏈壘鍒板搴旂殑娲诲姩銆?);
        return;
      }

      if (typeof activity.lat !== "number" || typeof activity.lng !== "number") {
        setNavigationStatus("璇ユ椿鍔ㄧ己灏戝湴鐞嗗潗鏍囷紝鏃犳硶鍙戣捣瀵艰埅銆?);
        return;
      }

      const origin = resolveNavigationOrigin(dayIndex, activityIndex);

      if (!origin) {
        setNavigationStatus("鏃犳硶纭畾璧风偣锛岃鍏堝～鍐欏嚭鍙戝湴鎴栦负鍓嶄竴娲诲姩鎻愪緵鍧愭爣銆?);
        return;
      }

      const requestId = options?.reuseExistingRequestId ?? latestNavigationAttemptRef.current + 1;
      latestNavigationAttemptRef.current = requestId;
      setNavigationLoading(true);
      setNavigationStatus(`姝ｅ湪璇锋眰楂樺痉璺嚎锛?{navigationModeLabel}锛?..`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      try {
        const requestBody: {
          origin: { lat: number; lng: number };
          destination: { lat: number; lng: number };
          mode: PlannerRoute["mode"];
          strategy?: string;
        } = {
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: activity.lat, lng: activity.lng },
          mode: navigationMode
        };

        if (navigationMode === "driving") {
          requestBody.strategy = "0";
        }

        const response = await fetch("/api/maps/directions", {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody)
        });

        const json = await response.json();

        if (!response.ok || !json?.ok) {
          const errorMessage = json?.error ?? "璺嚎璇锋眰澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
          throw new Error(errorMessage);
        }

        const data = json.data as {
          points: Array<{ lat: number; lng: number }>;
          distanceMeters: number;
          durationSeconds: number;
          mode: PlannerRoute["mode"];
        };

        const resolvedMode = data.mode ?? navigationMode;
        const resolvedModeLabel = NAVIGATION_MODE_LABELS[resolvedMode];

        setRoute({
          points: data.points,
          distanceMeters: data.distanceMeters,
          durationSeconds: data.durationSeconds,
          origin,
          destination: {
            lat: activity.lat,
            lng: activity.lng,
            label: activity.title,
            address: activity.address
          },
          mode: resolvedMode
        });

        lastSuccessfulNavigationRef.current = { dayIndex, activityIndex };

        setFocusedMarker({
          lat: activity.lat,
          lng: activity.lng,
          label: activity.title,
          address: activity.address
        });

        setIsMapVisible(true);
        setNavigationStatus(
          `璺嚎宸叉洿鏂帮紙${resolvedModeLabel}锛夛細绾?${formatDistance(data.distanceMeters)}锛岄璁¤€楁椂 ${formatDuration(
            data.durationSeconds
          )}銆俙
        );
      } catch (error) {
        if (latestNavigationAttemptRef.current !== requestId) {
          return;
        }

        const message = error instanceof Error ? error.message : "璺嚎璇锋眰澶辫触锛岃绋嶅悗鍐嶈瘯銆?;
        setNavigationStatus(`${message}锛?{navigationModeLabel}锛塦);
      } finally {
        if (latestNavigationAttemptRef.current === requestId) {
          setNavigationLoading(false);
        }
      }
    },
    [
      result,
      resolveNavigationOrigin,
      setRoute,
      setFocusedMarker,
      setIsMapVisible,
      accessToken,
      navigationMode,
      navigationModeLabel
    ]
  );

  useEffect(() => {
    if (!lastSuccessfulNavigationRef.current) {
      return;
    }

    const { dayIndex, activityIndex } = lastSuccessfulNavigationRef.current;
    void handleNavigateToActivity(dayIndex, activityIndex, {
      reuseExistingRequestId: latestNavigationAttemptRef.current + 1
    });
  }, [navigationMode, handleNavigateToActivity]);

  const handleClearRoute = useCallback(() => {
    clearRoute();
    lastSuccessfulNavigationRef.current = null;
    setNavigationStatus("宸茬Щ闄ゅ鑸矾绾裤€?);
    setNavigationLoading(false);
  }, [clearRoute]);

  return (
    <section className="flex flex-col gap-10">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-4 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
          AI Powered
        </span>
        <h1 className="text-4xl font-semibold text-white md:text-5xl">琛岀▼瑙勫垝鍔╂墜</h1>
        <p className="max-w-2xl text-slate-300">
          杈撳叆鐩殑鍦般€佽绋嬪亸濂戒笌棰勭畻锛孉I 灏嗙敓鎴愭瘡鏃ヨ绋嬪畨鎺掋€備篃鍙互浣跨敤璇煶琛ュ厖鐏垫劅锛岄殢鍚庝綘鍙互鍦ㄤ氦浜掑湴鍥句笌鏃堕棿绾夸笂鎺㈢储姣忎釜鍦扮偣銆?        </p>
      </header>

      <form
        className="grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg md:grid-cols-2"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <span className="text-sm font-medium text-slate-200">蹇嵎杈撳叆锛堣闊?/ 鏂囧瓧锛?/span>
            <p className="text-xs text-slate-400">鎻忚堪鏃呰闇€姹傦紝绯荤粺浼氳嚜鍔ㄥ～鍏呯洰鐨勫湴銆佸ぉ鏁般€侀绠椼€佸悓琛屼汉鏁颁笌鍋忓ソ銆?/p>
            <textarea
              value={smartInput}
              onChange={(event) => {
                setSmartInput(event.target.value);
                setSmartInputMessage(null);
              }}
              className="h-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="渚嬪锛氭垜浠?涓汉甯︿簡1涓囧潡閽辨兂鍘讳笂娴风帺4澶? 鎴戜滑鍠滄缇庨鍜屾埛澶栨椿鍔?
            />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSmartInputParse}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white transition hover:bg-slate-700 disabled:opacity-60"
                  disabled={parsing}
                >
                  {parsing ? "瑙ｆ瀽涓?.." : "瑙ｆ瀽鏂囧瓧鎻忚堪"}
                </button>
                <VoiceRecorder onText={handleVoiceText} onBeforeStart={clearPrimaryFormFields} />
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
            <span className="text-sm font-medium text-slate-200">鍑哄彂鍦?/span>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={form.origin ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setField("origin", value);
                  setLocationStatus(value.trim().length > 0 ? `鍑哄彂鍦帮細${value.trim()}` : "鎮ㄥ彲浠ュ畾浣嶆垨濉啓鍑哄彂鍦?);
                }}
                onBlur={(event) => {
                  if (!event.target.value.trim()) {
                    detectCurrentOrigin({ updateEmptyOrigin: true });
                  }
                }}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                placeholder="瀹氫綅鎴栨墜鍔ㄥ～鍐欏嚭鍙戝湴"
              />
              <button
                type="button"
                onClick={() => {
                  void detectCurrentOrigin();
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                disabled={locating}
              >
                {locating ? "瀹氫綅涓?.." : "閲嶆柊瀹氫綅"}
              </button>
            </div>
            {locationStatus && <p className="text-xs text-slate-400">{locationStatus}</p>}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">鐩殑鍦?/span>
            <input
              type="text"
              value={form.destination}
              onChange={(event) => setField("destination", event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="渚嬪锛氫笂娴?
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">琛岀▼澶╂暟</span>
            <input
              type="number"
              min={1}
              value={form.days}
              onChange={(event) => setField("days", Math.max(1, Number(event.target.value) || 1))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">棰勭畻锛堝厓锛?/span>
            <input
              type="number"
              min={0}
              value={form.budget ?? ""}
              onChange={(event) =>
                setField("budget", event.target.value ? Math.max(0, Number(event.target.value)) : undefined)
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="鍙€?
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">鍚岃浜烘暟</span>
            <input
              type="number"
              min={1}
              value={form.partySize ?? ""}
              onChange={(event) =>
                setField("partySize", event.target.value ? Math.max(1, Number(event.target.value)) : undefined)
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="鍙€?
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-200">鍋忓ソ鏍囩</span>
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
                宸查€夋嫨锛歿form.preferences.join("銆?)}
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
            {loading ? "鐢熸垚涓?.." : "鐢熸垚琛岀▼"}
          </button>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <h3 className="mb-2 text-base font-semibold text-white">浜戠琛岀▼</h3>
            <div className="flex flex-col gap-2">
              {activePlanId && (
                <div className="flex items-center justify-between rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                  <span>褰撳墠缂栬緫浜戠琛岀▼</span>
                  <button
                    type="button"
                    className="rounded border border-blue-400 px-2 py-1 text-[11px] text-blue-100 transition hover:bg-blue-500/20"
                    onClick={() => setActivePlanId(null)}
                  >
                    鍙﹀瓨涓烘柊琛岀▼
                  </button>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">琛岀▼鏍囬</span>
                <input
                  type="text"
                  value={planTitle}
                  onChange={(event) => setPlanTitle(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  placeholder="渚嬪锛氫笂娴?鏃ユ父"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">鎽樿澶囨敞锛堝彲閫夛級</span>
                <textarea
                  value={planSummary}
                  onChange={(event) => setPlanSummary(event.target.value)}
                  className="h-20 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  placeholder="绠€瑕佹弿杩拌繖涓绋嬬殑浜偣鎴栨敞鎰忎簨椤?
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSavePlan}
                  disabled={savingPlan}
                  className="rounded-lg border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingPlan
                    ? activePlanId
                      ? "鏇存柊涓?.."
                      : "淇濆瓨涓?.."
                    : activePlanId
                      ? "鏇存柊浜戠琛岀▼"
                      : "淇濆瓨鍒颁簯绔?}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPlans((prev) => !prev)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                >
                  {showPlans ? "鏀惰捣浜戠琛岀▼" : "鏌ョ湅浜戠琛岀▼"}
                </button>
              </div>
              {showPlans && (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  {loadingPlans ? (
                    <p className="text-xs text-slate-400">姝ｅ湪鍔犺浇...</p>
                  ) : plansError ? (
                    <p className="text-xs text-red-400">{plansError}</p>
                  ) : plans.length === 0 ? (
                    <p className="text-xs text-slate-400">灏氭湭淇濆瓨琛岀▼銆?/p>
                  ) : (
                    <ul className="flex flex-col gap-2 text-xs">
                      {plans.map((plan) => {
                        const isActivePlan = activePlanId === plan.id;

                        return (
                          <li
                            key={plan.id}
                            className={`rounded border p-2 transition ${
                              isActivePlan
                                ? "border-blue-500/60 bg-blue-500/10"
                                : "border-slate-800 bg-slate-900/80 hover:border-blue-500/40"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white" title={plan.title}>
                                {plan.title}
                              </p>
                              {plan.summary && (
                                <p className="mt-1 line-clamp-2 text-slate-400" title={plan.summary}>
                                  {plan.summary}
                                </p>
                              )}
                              <p className="mt-1 text-[11px] text-slate-500">
                                鏇存柊浜?{new Date(plan.updatedAt).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => handleLoadPlan(plan.id)}
                                className="rounded border border-blue-500 px-2 py-1 text-[11px] text-blue-300 transition hover:bg-blue-500/10"
                              >
                                鍔犺浇
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePlan(plan.id)}
                                className="rounded border border-red-500 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/10"
                              >
                                鍒犻櫎
                              </button>
                            </div>
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {result ? (
            <div className="space-y-3 text-sm text-slate-300">
              {form.origin && (
                <div>
                  <span className="font-semibold text-white">鍑哄彂鍦帮細</span>
                  {form.origin}
                </div>
              )}
              <div>
                <span className="font-semibold text-white">鐩殑鍦帮細</span>
                {result.destination}锛堝叡 {result.days} 澶╋級
              </div>
              {typeof result.budget_estimate === "number" && (
                <div>
                  <span className="font-semibold text-white">棰勭畻浼拌锛?/span>楼{result.budget_estimate.toFixed(0)}
                </div>
              )}
              {result.preference_tags.length > 0 && (
                <div>
                  <span className="font-semibold text-white">鍋忓ソ鏍囩锛?/span>
                  {result.preference_tags.join("銆?)}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">鎻愪氦鍚庡皢鍦ㄦ灞曠ず鎽樿銆?/p>
          )}
        </div>
      </form>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div
          ref={mapSectionRef}
          tabIndex={-1}
          className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">浜掑姩鍦板浘</h2>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>鎷栧姩缂╂斁浠ユ煡鐪嬫瘡鏃ュ湴鐐?/span>
              <button
                type="button"
                onClick={handleScrollToLastActivity}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 transition hover:border-blue-500 hover:text-blue-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                disabled={!lastActivityElementId}
              >
                杩斿洖娲诲姩璇︽儏
              </button>
              {hasMarkerHistory && (
                <button
                  type="button"
                  onClick={handleReturnToPrevious}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                >
                  杩斿洖涓婁竴涓湴鐐?                </button>
              )}
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-400">瀵艰埅鏂瑰紡锛?/span>
            {NAVIGATION_MODE_SEQUENCE.map((mode) => {
              const label = NAVIGATION_MODE_LABELS[mode];
              const isActive = navigationMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setNavigationMode(mode)}
                  className={`rounded-full border px-3 py-1 transition ${
                    isActive
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-100"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-400 hover:text-cyan-100"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="relative h-80">
            <MapView
              markers={markers}
              focusedMarker={focusedMarker ?? undefined}
              route={routeForMap}
            />
          </div>
          {navigationStatus && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
              {navigationStatus}
              {navigationLoading && <span className="ml-2 text-slate-400">(鍔犺浇涓?</span>}
            </div>
          )}
          {activeRoute && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-sm text-cyan-100">
              <div className="space-y-1">
                <p>
                  瀵艰埅璺嚎锛?                  {activeRoute.origin?.label ?? "璧风偣"}
                  <span className="mx-1 text-cyan-300">鈫?/span>
                  {activeRoute.destination?.label ?? "缁堢偣"}
                </p>
                <p className="text-cyan-200">
                  璺濈绾?{formatDistance(activeRoute.distanceMeters)} 路 棰勮鑰楁椂 {formatDuration(activeRoute.durationSeconds)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearRoute}
                className="rounded border border-cyan-400/80 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100 transition hover:bg-cyan-500/20"
              >
                娓呴櫎璺嚎
              </button>
            </div>
          )}
          {markers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/60 p-4 text-center text-sm text-slate-400">
              <p className="text-base font-medium text-slate-300">濉啓琛ㄥ崟骞剁敓鎴愯绋嬪悗锛屽皢鍩轰簬姣忔棩娲诲姩鑷姩鎵撶偣銆?/p>
              <p>褰撳墠灞曠ず鐨勬槸搴曞浘锛屼綘浠嶇劧鍙互鎷栧姩鎴栫缉鏀炬煡鐪嬪煄甯傛瑙堛€?/p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">鏃ョ▼鏃堕棿绾?/h2>
              <span className="text-xs text-slate-400">鎸夊ぉ鏌ョ湅璇︾粏瀹夋帓</span>
            </header>
            <ItineraryTimeline
              itinerary={result}
              onActivityFocus={handleActivityFocus}
              onActivitySelect={handleActivitySelect}
              onActivityUpdate={updateActivity}
              onActivityNavigate={handleNavigateToActivity}
            />
          </div>
        </div>
      </section>
      {floatingMapOverlay}
    </section>
  );
}
