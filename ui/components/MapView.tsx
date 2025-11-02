"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapProvider } from "../../src/lib/maps/provider";

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

type RoutePath = {
  points: Array<{ lat: number; lng: number }>;
  provider?: MapProvider | null;
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
  showInfoWindow?: boolean;
  route?: RoutePath | null;
  provider?: MapProvider;
  selecting?: boolean;
  onSelectPoint?: (point: { lat: number; lng: number }) => void;
  selectionPoint?: { lat: number; lng: number } | null;
};

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
    google?: any;
  }
}

const DEFAULT_CENTER: [number, number] = [116.397389, 39.908722];
const DEFAULT_ZOOM_EMPTY = 3;
const DEFAULT_GOOGLE_ZOOM_EMPTY = 2;
const GOOGLE_BOUNDS_PADDING_DEFAULT = { top: 72, right: 80, bottom: 96, left: 80 } as const;
const GOOGLE_BOUNDS_PADDING_COMPACT = { top: 40, right: 48, bottom: 64, left: 48 } as const;

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

export function MapView({
  markers,
  focusedMarker = null,
  compact = false,
  showInfoWindow = true,
  route = null,
  provider = "amap",
  selecting = false,
  onSelectPoint,
  selectionPoint = null
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const markerInstancesRef = useRef<Array<{ overlay: any; marker: Marker }>>([]);
  const routeOverlayRef = useRef<{ polyline?: any } | null>(null);
  const selectionOverlayRef = useRef<any>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkersRef = useRef<Array<{ marker: any; listeners: any[] }>>([]);
  const googlePolylineRef = useRef<any>(null);
  const googleInfoWindowRef = useRef<any>(null);
  const googleSelectionMarkerRef = useRef<any>(null);
  const googleClickListenerRef = useRef<any>(null);
  const googleRouteBoundsRef = useRef<any>(null);
  const amapRouteBoundsRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const hasMountedRef = useRef(false);

  const token = useMemo(() => process.env.NEXT_PUBLIC_AMAP_WEB_KEY, []);
  const securityCode = useMemo(() => process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE, []);
  const googleApiKey = useMemo(() => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, []);
  const validMarkers = useMemo(
    () => markers.filter((marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)),
    [markers]
  );
  const [sdkReady, setSdkReady] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const isGoogleProvider = provider === "google";
  const providerLabel = isGoogleProvider ? "Google Maps" : "高德地图";
  const googleBoundsPadding = useMemo(() => {
    const preset = compact ? GOOGLE_BOUNDS_PADDING_COMPACT : GOOGLE_BOUNDS_PADDING_DEFAULT;
    return { ...preset };
  }, [compact]);

  useEffect(() => {
    setStatus("loading");
  }, [provider]);

  const disposeGoogleResources = useCallback(() => {
    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const googleEvent = googleGlobal?.maps?.event;

    googleMarkersRef.current.forEach(({ marker, listeners }) => {
      listeners.forEach((listener) => {
        try {
          googleEvent?.removeListener?.(listener);
        } catch {
          /* ignore */
        }
      });
      marker?.setMap?.(null);
    });
    googleMarkersRef.current = [];

    if (googlePolylineRef.current) {
      try {
        googlePolylineRef.current.setMap?.(null);
      } catch {
        /* ignore */
      }
      googlePolylineRef.current = null;
    }

    if (googleSelectionMarkerRef.current) {
      googleSelectionMarkerRef.current.setMap?.(null);
      googleSelectionMarkerRef.current = null;
    }

    if (googleClickListenerRef.current) {
      try {
        googleEvent?.removeListener?.(googleClickListenerRef.current);
      } catch {
        /* ignore */
      }
    }
    googleClickListenerRef.current = null;

    if (googleInfoWindowRef.current?.close) {
      try {
        googleInfoWindowRef.current.close();
      } catch {
        /* ignore */
      }
    }
    googleInfoWindowRef.current = null;
    googleMapRef.current = null;
    setGoogleReady(false);
  }, []);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

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
        if (showInfoWindow && typeof AMap.InfoWindow === "function") {
          infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -28) });
        } else {
          infoWindowRef.current = null;
        }

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

      if (routeOverlayRef.current?.polyline) {
        routeOverlayRef.current.polyline.setMap(null);
        routeOverlayRef.current = null;
      }

      if (selectionOverlayRef.current) {
        selectionOverlayRef.current.setMap(null);
        selectionOverlayRef.current = null;
      }

      infoWindowRef.current?.close?.();
      infoWindowRef.current = null;

      mapRef.current?.destroy?.();
      mapRef.current = null;
      setSdkReady(false);
      debug("cleanup: disposed map");
    };
  }, [provider, token, securityCode]);

  useEffect(() => {
    if (!isGoogleProvider) {
      disposeGoogleResources();
      return;
    }

    if (!containerRef.current) {
      debug("google init: missing container element");
      return;
    }

    if (!googleApiKey) {
      debug("google init: missing API key");
      setStatus("error");
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const initializeMap = () => {
      const googleGlobal = window.google;

      if (!googleGlobal?.maps) {
        debug("google init: maps namespace unavailable after load");
        setStatus("error");
        return;
      }

      disposeGoogleResources();

      const map = new googleGlobal.maps.Map(containerRef.current as HTMLElement, {
        center: { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] },
        zoom: DEFAULT_GOOGLE_ZOOM_EMPTY,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        scaleControl: true
      });

      googleMapRef.current = map;
      googleInfoWindowRef.current = null;

      setStatus("ready");
      setGoogleReady(true);
    };

    if (window.google?.maps) {
      initializeMap();
      return () => {
        disposeGoogleResources();
      };
    }

    let active = true;
    const scriptId = "google-maps-sdk";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const handleLoad = () => {
      if (!active) {
        return;
      }
      initializeMap();
    };

    const handleError = () => {
      if (!active) {
        return;
      }
      debug("google init: script load failed");
      setStatus("error");
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&language=zh-CN`;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);
    }

    setStatus("loading");

    return () => {
      active = false;
      if (script) {
        script.removeEventListener("load", handleLoad);
        script.removeEventListener("error", handleError);
      }
    };
  }, [isGoogleProvider, googleApiKey, disposeGoogleResources]);

  useEffect(() => {
    if (!isGoogleProvider) {
      return;
    }

    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const map = googleMapRef.current;

    if (!googleReady || !map || !googleGlobal?.maps) {
      return;
    }

    const googleEvent = googleGlobal.maps.event;

    if (!googleEvent) {
      return;
    }

    googleMarkersRef.current.forEach(({ marker, listeners }) => {
      listeners.forEach((listener) => {
        try {
          googleEvent?.removeListener?.(listener);
        } catch {
          /* ignore */
        }
      });
      marker?.setMap?.(null);
    });
    googleMarkersRef.current = [];

    if (showInfoWindow) {
      if (!googleInfoWindowRef.current) {
        googleInfoWindowRef.current = new googleGlobal.maps.InfoWindow();
      }
    } else if (googleInfoWindowRef.current?.close) {
      googleInfoWindowRef.current.close();
      googleInfoWindowRef.current = null;
    }

    if (validMarkers.length === 0) {
      map.setCenter({ lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] });
      map.setZoom(DEFAULT_GOOGLE_ZOOM_EMPTY);
      return;
    }

    const infoWindow = googleInfoWindowRef.current;
    const nextMarkers: Array<{ marker: any; listeners: any[] }> = [];

    for (const marker of validMarkers) {
      const googleMarker = new googleGlobal.maps.Marker({
        position: { lat: marker.lat, lng: marker.lng },
        map,
        title: marker.label,
        label: marker.sequenceLabel
      });

      const listeners: any[] = [];

      if (showInfoWindow && infoWindow) {
        const content = buildInfoContent(marker);
        listeners.push(
          googleEvent.addListener(googleMarker, "mouseover", () => {
            infoWindow.setContent(content);
            infoWindow.open({ map, anchor: googleMarker });
          })
        );
        listeners.push(
          googleEvent.addListener(googleMarker, "mouseout", () => {
            infoWindow.close();
          })
        );
      }

      nextMarkers.push({ marker: googleMarker, listeners });
    }

    googleMarkersRef.current = nextMarkers;

    const routePoints = Array.isArray(route?.points) ? route.points : [];
    const hasActiveRoute = routePoints.length >= 2;

    if (hasActiveRoute) {
      if (googleRouteBoundsRef.current) {
        map.fitBounds(googleRouteBoundsRef.current, googleBoundsPadding);
      }
      return;
    }

    if (validMarkers.length === 1) {
      const single = validMarkers[0];
      map.setCenter({ lat: single.lat, lng: single.lng });
      const currentZoom = map.getZoom?.();
      const targetZoom = typeof currentZoom === "number" ? Math.max(currentZoom, 13) : 13;
      map.setZoom(targetZoom);
    } else {
      const bounds = new googleGlobal.maps.LatLngBounds();
      validMarkers.forEach((marker) => {
        bounds.extend(new googleGlobal.maps.LatLng(marker.lat, marker.lng));
      });

      if (!bounds.isEmpty?.()) {
        map.fitBounds(bounds, googleBoundsPadding);
      }
    }
  }, [isGoogleProvider, googleReady, validMarkers, showInfoWindow, route, googleBoundsPadding]);

  useEffect(() => {
    if (!isGoogleProvider) {
      return;
    }

    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const map = googleMapRef.current;

    if (!googleReady || !map || !googleGlobal?.maps) {
      return;
    }

    if (googleSelectionMarkerRef.current) {
      googleSelectionMarkerRef.current.setMap?.(null);
      googleSelectionMarkerRef.current = null;
    }

    if (!selectionPoint || !Number.isFinite(selectionPoint.lat) || !Number.isFinite(selectionPoint.lng)) {
      return;
    }

    googleSelectionMarkerRef.current = new googleGlobal.maps.Marker({
      position: { lat: selectionPoint.lat, lng: selectionPoint.lng },
      map,
      icon: undefined
    });
  }, [isGoogleProvider, googleReady, selectionPoint]);

  useEffect(() => {
    if (!isGoogleProvider) {
      return;
    }

    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const map = googleMapRef.current;

    if (!googleReady || !map || !googleGlobal?.maps) {
      return;
    }

    const googleEvent = googleGlobal.maps.event;

    if (!googleEvent?.addListener) {
      return () => {
        map.setOptions?.({ draggableCursor: undefined });
      };
    }

    if (googleClickListenerRef.current) {
      try {
        googleEvent?.removeListener?.(googleClickListenerRef.current);
      } catch {
        /* ignore */
      }
      googleClickListenerRef.current = null;
    }

    if (!selecting) {
      map.setOptions?.({ draggableCursor: undefined });
      return;
    }

    map.setOptions?.({ draggableCursor: "crosshair" });

  googleClickListenerRef.current = googleEvent.addListener(map, "click", (event: any) => {
      if (!onSelectPoint) {
        return;
      }

      const latLng = event?.latLng;

      if (!latLng) {
        return;
      }

      const lat = latLng.lat?.();
      const lng = latLng.lng?.();

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        onSelectPoint({ lat, lng });
      }
    });

    return () => {
      map.setOptions?.({ draggableCursor: undefined });
      if (googleClickListenerRef.current) {
        try {
          googleEvent?.removeListener?.(googleClickListenerRef.current);
        } catch {
          /* ignore */
        }
        googleClickListenerRef.current = null;
      }
    };
  }, [isGoogleProvider, googleReady, selecting, onSelectPoint]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

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

      if (showInfoWindow && infoWindowRef.current) {
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

    const routePoints = Array.isArray(route?.points) ? route.points : [];
    const hasActiveRoute = routePoints.length >= 2;

    if (hasActiveRoute) {
      if (amapRouteBoundsRef.current && typeof map.setBounds === "function") {
        map.setBounds(amapRouteBoundsRef.current);
      } else if (routeOverlayRef.current?.polyline && typeof map.setFitView === "function") {
        map.setFitView([routeOverlayRef.current.polyline]);
      }
      return;
    }

    if (instances.length > 0) {
      map.setFitView(instances.map((item) => item.overlay));
      debug("markers effect: fit view");
    }
  }, [provider, validMarkers, status, sdkReady, showInfoWindow, route]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

    const map = mapRef.current;
    const AMapCtor = typeof window !== "undefined" && sdkReady ? window.AMap : undefined;

    if (!map || !AMapCtor) {
      return;
    }

    if (selectionOverlayRef.current) {
      selectionOverlayRef.current.setMap(null);
      selectionOverlayRef.current = null;
    }

    if (selectionPoint && Number.isFinite(selectionPoint.lat) && Number.isFinite(selectionPoint.lng)) {
      const overlay = new AMapCtor.Marker({
        position: [selectionPoint.lng, selectionPoint.lat],
        icon: new AMapCtor.Icon({
          size: new AMapCtor.Size(26, 36),
          image: "//a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-default.png",
          imageSize: new AMapCtor.Size(26, 36)
        }),
        offset: new AMapCtor.Pixel(-13, -36)
      });

      overlay.setMap(map);
      selectionOverlayRef.current = overlay;
    }

    return () => {
      if (selectionOverlayRef.current) {
        selectionOverlayRef.current.setMap(null);
        selectionOverlayRef.current = null;
      }
    };
  }, [provider, selectionPoint, sdkReady]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

    const map = mapRef.current;
    const AMapCtor = typeof window !== "undefined" && sdkReady ? window.AMap : undefined;

    if (!map || !AMapCtor) {
      return;
    }

    const handleClick = (event: { lnglat: { getLat: () => number; getLng: () => number } }) => {
      if (!onSelectPoint) {
        return;
      }

      const lat = event.lnglat.getLat();
      const lng = event.lnglat.getLng();

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        onSelectPoint({ lat, lng });
      }
    };

    if (selecting) {
      map.setCursor("crosshair");
      map.on("click", handleClick);
    } else {
      map.setCursor("default");
    }

    return () => {
      map.off("click", handleClick);
      if (!selecting) {
        map.setCursor("default");
      }
    };
  }, [provider, selecting, sdkReady, onSelectPoint]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

    const map = mapRef.current;
    const AMapCtor = typeof window !== "undefined" && sdkReady ? window.AMap : undefined;

    if (routeOverlayRef.current?.polyline) {
      routeOverlayRef.current.polyline.setMap(null);
      routeOverlayRef.current = null;
    }

    amapRouteBoundsRef.current = null;

    if (!map || status !== "ready" || !AMapCtor) {
      return;
    }

    const pathPoints = (route?.points ?? []).filter((point) =>
      Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );

    if (pathPoints.length < 2) {
      return;
    }

    const polyline = new AMapCtor.Polyline({
      path: pathPoints.map((point) => new AMapCtor.LngLat(point.lng, point.lat)),
      showDir: true,
      strokeColor: "#38bdf8",
      strokeWeight: 6,
      strokeOpacity: 0.85,
      lineJoin: "round",
      lineCap: "round"
    });

    polyline.setMap(map);
    routeOverlayRef.current = { polyline };

    amapRouteBoundsRef.current = typeof polyline.getBounds === "function" ? polyline.getBounds() : null;

    if (amapRouteBoundsRef.current && typeof map.setFitView === "function") {
      map.setFitView([polyline]);
    } else {
      const overlays = markerInstancesRef.current.map((item) => item.overlay);
      overlays.push(polyline);

      if (overlays.length > 0 && typeof map.setFitView === "function") {
        map.setFitView(overlays);
      }
    }

    return () => {
      polyline.setMap(null);
      if (routeOverlayRef.current?.polyline === polyline) {
        routeOverlayRef.current = null;
      }
      amapRouteBoundsRef.current = null;
    };
  }, [provider, route, status, sdkReady]);

  useEffect(() => {
    if (!isGoogleProvider) {
      return;
    }

    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const map = googleMapRef.current;

    if (!googleReady || !map || !googleGlobal?.maps) {
      googleRouteBoundsRef.current = null;
      return;
    }

    if (googlePolylineRef.current) {
      try {
        googlePolylineRef.current.setMap?.(null);
      } catch {
        /* ignore */
      }
      googlePolylineRef.current = null;
    }

    googleRouteBoundsRef.current = null;

    const pathPoints = (route?.points ?? []).filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );

    if (pathPoints.length < 2) {
      return;
    }

    const polyline = new googleGlobal.maps.Polyline({
      path: pathPoints.map((point) => ({ lat: point.lat, lng: point.lng })),
      geodesic: true,
      strokeColor: "#38bdf8",
      strokeOpacity: 0.85,
      strokeWeight: 5
    });

    polyline.setMap(map);
    googlePolylineRef.current = polyline;

    googleRouteBoundsRef.current = (function buildBounds() {
      const bounds = new googleGlobal.maps.LatLngBounds();
      pathPoints.forEach((point) => bounds.extend(new googleGlobal.maps.LatLng(point.lat, point.lng)));
      return bounds.isEmpty?.() ? null : bounds;
    })();

    if (googleRouteBoundsRef.current) {
      map.fitBounds(googleRouteBoundsRef.current, googleBoundsPadding);
    }
  }, [isGoogleProvider, googleReady, route, googleBoundsPadding]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

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

    if (showInfoWindow && infoWindowRef.current) {
      const content = buildInfoContent({
        lat: contentMarker.lat,
        lng: contentMarker.lng,
        label: contentMarker.label ?? "",
        address: contentMarker.address
      });

      if (googleRouteBoundsRef.current && typeof infoWindowRef.current?.close === "function") {
        infoWindowRef.current.close();
      }

      infoWindowRef.current.setContent(content);
      infoWindowRef.current.open(map, position);
    }

    return () => {
      if (recentreTimer) {
        window.clearTimeout(recentreTimer);
      }
    };
  }, [provider, focusedMarker, status, showInfoWindow]);

  useEffect(() => {
    if (!isGoogleProvider) {
      return;
    }

    const googleGlobal = typeof window !== "undefined" ? window.google : undefined;
    const map = googleMapRef.current;

    if (!googleReady || !map || !googleGlobal?.maps) {
      return;
    }

    if (!focusedMarker) {
      googleInfoWindowRef.current?.close?.();
      return;
    }

    const position = new googleGlobal.maps.LatLng(focusedMarker.lat, focusedMarker.lng);
    const hasActiveRoute = Array.isArray(route?.points) && route.points.length >= 2;

    if (hasActiveRoute) {
      map.panTo(position);
      const currentZoom = map.getZoom?.();
      const targetZoom = typeof currentZoom === "number" ? Math.max(currentZoom, 13) : 13;
      map.setZoom(targetZoom);
    } else if (googleRouteBoundsRef.current) {
      map.fitBounds(googleRouteBoundsRef.current, googleBoundsPadding);
    } else {
      map.panTo(position);
      const currentZoom = map.getZoom?.();
      const targetZoom = typeof currentZoom === "number" ? Math.max(currentZoom, 13) : 13;
      map.setZoom(targetZoom);
    }

    if (!showInfoWindow) {
      googleInfoWindowRef.current?.close?.();
      return;
    }

    if (!googleInfoWindowRef.current) {
      googleInfoWindowRef.current = new googleGlobal.maps.InfoWindow();
    }

    const infoWindow = googleInfoWindowRef.current;

    const epsilon = 1e-6;
    const targetMarkerEntry = googleMarkersRef.current.find(({ marker }) => {
      const markerPosition = marker.getPosition?.();

      if (!markerPosition) {
        return false;
      }

      const latDiff = Math.abs(markerPosition.lat() - focusedMarker.lat);
      const lngDiff = Math.abs(markerPosition.lng() - focusedMarker.lng);
      return latDiff < epsilon && lngDiff < epsilon;
    });

    const content = buildInfoContent({
      lat: focusedMarker.lat,
      lng: focusedMarker.lng,
      label: focusedMarker.label ?? "行程活动",
      address: focusedMarker.address,
      sequenceGroup: focusedMarker.label
        ? [
            {
              sequence: 1,
              label: focusedMarker.label,
              address: focusedMarker.address
            }
          ]
        : undefined
    } as Marker);

    infoWindow.setContent(content);

    if (targetMarkerEntry?.marker) {
      infoWindow.open({ map, anchor: targetMarkerEntry.marker });
    } else {
      infoWindow.setPosition(position);
      infoWindow.open({ map });
    }
  }, [isGoogleProvider, googleReady, focusedMarker, showInfoWindow, googleBoundsPadding, route]);

  useEffect(() => {
    if (provider !== "amap") {
      return;
    }

    const AMapCtor = typeof window !== "undefined" && sdkReady ? window.AMap : undefined;

    if (!AMapCtor) {
      return;
    }

    if (showInfoWindow && typeof AMapCtor.InfoWindow === "function") {
      if (!infoWindowRef.current) {
        infoWindowRef.current = new AMapCtor.InfoWindow({ offset: new AMapCtor.Pixel(0, -28) });
      }
    } else {
      infoWindowRef.current?.close?.();
      infoWindowRef.current = null;
    }
  }, [provider, showInfoWindow, sdkReady]);

  if (status === "error") {
    const errorHeightClass = compact ? "h-48" : "h-80";
    return (
      <div
        className={`flex ${errorHeightClass} items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/70 text-sm text-slate-400`}
      >
        {providerLabel} 加载失败，请检查 API Key 配置。
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
