"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

type Marker = {
  lat: number;
  lng: number;
  label: string;
  address?: string;
};

type MapViewProps = {
  markers: Marker[];
};

const DotMap = dynamic(async () => (await import("@ant-design/maps")).DotMap, {
  ssr: false,
  loading: () => <div className="flex h-64 items-center justify-center text-slate-400">地图加载中...</div>
});

export function MapView({ markers }: MapViewProps) {
  const [ready, setReady] = useState(false);

  const config = useMemo(() => {
    const validMarkers = markers.filter((marker) =>
      Number.isFinite(marker.lat) && Number.isFinite(marker.lng)
    );

    const center: [number, number] =
      validMarkers.length > 0 ? [validMarkers[0].lng, validMarkers[0].lat] : [116.397389, 39.908722];

    const data = validMarkers.map((marker) => ({
      lng: marker.lng,
      lat: marker.lat,
      name: marker.label,
      address: marker.address
    }));

    return {
      map: {
        type: "amap" as const,
        style: "blank",
        center,
        zoom: markers.length > 0 ? 12 : 3,
        pitch: 0
      },
      autoFit: markers.length > 0,
      source: {
        data,
        parser: {
          type: "json",
          x: "lng",
          y: "lat"
        }
      },
      size: 12,
      color: "#f97316",
      shape: "circle",
      tooltip: {
        items: ["name", "address"]
      },
      state: {
        active: true
      }
    };
  }, [markers]);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return <div className="flex h-64 items-center justify-center text-slate-400">地图初始化中...</div>;
  }

  return <DotMap {...config} containerStyle={{ height: 320, borderRadius: 12 }} />;
}
