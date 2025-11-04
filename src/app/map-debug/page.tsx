"use client";

import Image from "next/image";
import { MapView } from "../../../ui/components/MapView";

const demoMarkers = [
  { lat: 39.908722, lng: 116.397389, label: "天安门广场" },
  { lat: 31.230391, lng: 121.473701, label: "上海市中心" }
];

export default function MapDebugPage() {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-4 text-2xl font-semibold">地图组件调试</h1>
      <p className="mb-6 text-sm text-slate-400">
        此页面用于验证 `MapView` 组件能否正确加载高德底图与示例标记。
      </p>
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
        <MapView markers={demoMarkers} />
      </div>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">上海静态地图</h2>
        <p className="text-sm text-slate-400">通过服务端代理调用高德静态图 API，展示上海市中心示例。</p>
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <Image
            src="/api/map-static?location=121.473701,31.230391&zoom=11&size=960*600&scale=2"
            alt="上海静态地图"
            width={960}
            height={600}
            className="h-auto w-full"
            priority
          />
        </div>
      </section>
    </main>
  );
}
