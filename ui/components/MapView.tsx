"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Marker = {
  lat: number;
  lng: number;
  label: string;
  address?: string;
  sequenceLabel?: string;
  sequenceGroup?: Array<{
    sequence: number;
    label: string;
    address?: string;
  }>;
};

type MapViewProps = {
  markers: Marker[];
  focusedMarker?: {
    lat: number;
    lng: number;
    label?: string;
    address?: string;
  } | null;
  compact?: boolean;
};

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

const DEFAULT_CENTER: [number, number] = [116.397389, 39.908722];
const DEFAULT_ZOOM_EMPTY = 3;

const isDev = process.env.NODE_ENV !== "production";
const debug = (...args: unknown[]) => {
  if (isDev && typeof console !== "undefined") {
    console.log("[MapView]", ...args);
  }
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>'"]/g, (match) => {
    const table: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    };

    return table[match] ?? match;
  });
}

function buildInfoContent(marker: Marker): string {
  const sequenceGroup = marker.sequenceGroup ?? [];

  if (sequenceGroup.length <= 1) {
    const entry = sequenceGroup[0];
    const titleText = entry ? `${entry.sequence}. ${entry.label}` : marker.label;
    const title = escapeHtml(titleText);
    const addressSource = entry?.address ?? marker.address;
    const address = addressSource ? escapeHtml(addressSource) : null;

    return [`<strong style="display:block;color:#111827;">${title}</strong>`, address ? `<span style="color:#4b5563;">${address}</span>` : ""]
      .filter(Boolean)
      .join("");
  }

  const rows = sequenceGroup
    .map((entry, index) => {
      const isLast = index === sequenceGroup.length - 1;
      const title = escapeHtml(`${entry.sequence}. ${entry.label}`);
      const address = entry.address
        ? `<span style="display:block;color:#4b5563;margin-top:2px;">${escapeHtml(entry.address)}</span>`
        : "";
      const borderStyle = isLast ? "none" : "1px solid #e5e7eb";
      return `<div style="padding:4px 0;border-bottom:${borderStyle};">
        <strong style="display:block;color:#111827;">${title}</strong>
        ${address}
      </div>`;
    })
    .join("");

  return `<div style="max-width:220px;">${rows}</div>`;
}

function createNumberedMarkerElement(sequenceLabel: string) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.width = "auto";
  wrapper.style.minHeight = "44px";
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.cursor = "pointer";

  const circle = document.createElement("div");
  circle.textContent = sequenceLabel;
  circle.style.minWidth = "30px";
  circle.style.height = "30px";
  circle.style.borderRadius = "9999px";
  circle.style.background = "#2563eb";
  circle.style.color = "#fff";
  circle.style.display = "flex";
  circle.style.alignItems = "center";
  circle.style.justifyContent = "center";
  circle.style.fontWeight = "600";
  circle.style.fontSize = "12px";
  circle.style.boxShadow = "0 6px 12px rgba(37, 99, 235, 0.45)";
  circle.style.border = "2px solid #1d4ed8";
  circle.style.marginBottom = "6px";
  circle.style.padding = "0 10px";

  const pointer = document.createElement("div");
  pointer.style.position = "absolute";
  pointer.style.bottom = "0";
  pointer.style.left = "50%";
  pointer.style.transform = "translateX(-50%)";
  pointer.style.width = "0";
  pointer.style.height = "0";
  pointer.style.borderLeft = "6px solid transparent";
  pointer.style.borderRight = "6px solid transparent";
  pointer.style.borderBottom = "8px solid #2563eb";

  wrapper.appendChild(circle);
  wrapper.appendChild(pointer);

  return wrapper;
}

export function MapView({ markers, focusedMarker = null, compact = false }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const markerInstancesRef = useRef<Array<{ overlay: any; marker: Marker }>>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const hasMountedRef = useRef(false);

  const token = useMemo(() => process.env.NEXT_PUBLIC_AMAP_WEB_KEY, []);
  const securityCode = useMemo(() => process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE, []);
  const validMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers]
  );
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    async function initMap() {
      if (!containerRef.current) {
        debug("initMap: missing container element");
        return;
      }

      if (!token) {
        debug("initMap: NEXT_PUBLIC_AMAP_WEB_KEY not set");
        setStatus("error");
        return;
      }

      try {
        if (typeof window === "undefined") {
          debug("initMap: running during SSR, skipping");
          return;
        }

        debug("initMap: loading SDK", { hasSecurityCode: Boolean(securityCode) });
        const { default: AMapLoader } = await import("@amap/amap-jsapi-loader");

        if (securityCode) {
          window._AMapSecurityConfig = {
            securityJsCode: securityCode
          };
          debug("initMap: applied security config");
        }

        const AMap = (await AMapLoader.load({
          key: token,
          version: "2.0",
          plugins: ["AMap.ToolBar", "AMap.Scale"]
        })) as typeof window.AMap;

        if (typeof window !== "undefined") {
          window.AMap = AMap;
        }

        if (!AMap || typeof AMap.Map !== "function") {
          debug("initMap: invalid SDK response", { AMapType: typeof AMap });
          throw new Error("AMap SDK failed to load");
        }

        const map = new AMap.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM_EMPTY,
          mapStyle: "amap://styles/normal",
          viewMode: "2D",
          resizeEnable: true
        });

        debug("initMap: map created", { zoom: DEFAULT_ZOOM_EMPTY });

        if (AMap.ToolBar) {
          map.addControl(new AMap.ToolBar());
        }
        if (AMap.Scale) {
          map.addControl(new AMap.Scale());
        }

        mapRef.current = map;
        infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -28) });

        debug("initMap: map ready, markers", validMarkers.length);
        setStatus("ready");
        setSdkReady(true);
        hasMountedRef.current = true;
      } catch (error) {
        debug("initMap: error", error);
        setStatus("error");
      }
    }

    initMap();

    return () => {
  markerInstancesRef.current.forEach(({ overlay }) => overlay.setMap(null));
      markerInstancesRef.current = [];
      infoWindowRef.current?.close?.();
      infoWindowRef.current = null;
      mapRef.current?.destroy?.();
      mapRef.current = null;
      setSdkReady(false);
      debug("cleanup: disposed map");
    };
  }, [token, securityCode]);

  useEffect(() => {
    const map = mapRef.current;
    const AMapCtor = typeof window !== "undefined" && sdkReady ? window.AMap : undefined;

    if (!map || status !== "ready" || !AMapCtor) {
      debug("markers effect: waiting", { hasMap: Boolean(map), status, hasSDK: Boolean(AMapCtor) });
      return;
    }

  markerInstancesRef.current.forEach(({ overlay }) => overlay.setMap(null));
  markerInstancesRef.current = [];

    if (validMarkers.length === 0) {
      infoWindowRef.current?.close?.();
      map.setZoomAndCenter(DEFAULT_ZOOM_EMPTY, DEFAULT_CENTER);
      debug("markers effect: cleared markers");
      return;
    }

    debug("markers effect: rendering markers", { count: validMarkers.length });
    const instances = validMarkers.map((marker) => {
      const sequenceLabel = marker.sequenceLabel ??
        (marker.sequenceGroup && marker.sequenceGroup.length === 1
          ? String(marker.sequenceGroup[0].sequence)
          : undefined);
      const markerTitle = marker.sequenceGroup && marker.sequenceGroup.length > 1
        ? marker.sequenceGroup.map((entry) => `${entry.sequence}. ${entry.label}`).join(" / ")
        : sequenceLabel
        ? `${sequenceLabel}. ${marker.label}`
        : marker.label;
      const options: Record<string, unknown> = {
        position: [marker.lng, marker.lat],
        title: markerTitle
      };

      if (sequenceLabel) {
        const contentEl = createNumberedMarkerElement(sequenceLabel);
        if (contentEl) {
          options.content = contentEl;
          options.offset = new AMapCtor.Pixel(-16, -44);
        }
      }

      const overlay = new AMapCtor.Marker(options);

      if (infoWindowRef.current) {
        const content = buildInfoContent(marker);
        overlay.on("mouseover", () => {
          infoWindowRef.current.setContent(content);
          infoWindowRef.current.open(map, overlay.getPosition());
        });
        overlay.on("mouseout", () => {
          infoWindowRef.current.close();
        });
      }

      overlay.setMap(map);
      return { overlay, marker };
    });

    markerInstancesRef.current = instances;

    if (instances.length > 0) {
      map.setFitView(instances.map((item) => item.overlay));
      debug("markers effect: fit view");
    }
  }, [validMarkers, status, sdkReady]);

  useEffect(() => {
    const map = mapRef.current;
    const focused = focusedMarker;
    const AMapCtor = typeof window !== "undefined" ? window.AMap : undefined;

    if (!focused) {
      infoWindowRef.current?.close?.();
    }

    if (!map || status !== "ready" || !focused || !AMapCtor) {
      return;
    }

    const epsilon = 0.0001;
    const target = markerInstancesRef.current.find(({ marker }) => {
      return (
        Math.abs(marker.lat - focused.lat) < epsilon && Math.abs(marker.lng - focused.lng) < epsilon
      );
    });

    const position = target
      ? target.overlay.getPosition()
      : new AMapCtor.LngLat(focused.lng, focused.lat);

    const contentMarker = target?.marker ?? focused;

    const targetZoom = Math.max(map.getZoom?.() ?? DEFAULT_ZOOM_EMPTY, 13);

    if (typeof map.setZoomAndCenter === "function") {
      map.setZoomAndCenter(targetZoom, position);
    } else {
      map.setZoom?.(targetZoom);
      map.setCenter?.(position);
    }

    map.panTo?.(position);

    let recentreTimer: number | undefined;
    if (typeof window !== "undefined" && typeof map.panTo === "function") {
      recentreTimer = window.setTimeout(() => {
        map.panTo(position);
      }, 150);
    }

    if (infoWindowRef.current) {
      const content = buildInfoContent({
        lat: contentMarker.lat,
        lng: contentMarker.lng,
        label: contentMarker.label ?? "",
        address: contentMarker.address
      });
      infoWindowRef.current.setContent(content);
      infoWindowRef.current.open(map, position);
    }

    return () => {
      if (recentreTimer) {
        window.clearTimeout(recentreTimer);
      }
    };
  }, [focusedMarker, status]);

  if (status === "error") {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/70 text-sm text-slate-400">
        地图加载失败，请检查 API Key 配置。
      </div>
    );
  }

  const containerClassName = compact
    ? "relative h-48 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
    : "relative h-80 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60";
  const minHeight = compact ? "200px" : "320px";

  return (
    <div className={containerClassName} aria-label="互动地图">
      <div ref={containerRef} className="h-full w-full" style={{ minHeight }} />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
          地图加载中...
        </div>
      )}
    </div>
  );
}
