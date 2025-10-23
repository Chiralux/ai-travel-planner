import Image from "next/image";

const GALLERY = [
  {
    title: "海滨假日",
    description: "漫步于海风轻拂的海岸线，度过惬意慢节奏的旅程。",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "都市探索",
    description: "穿梭于霓虹都市，沉浸在文化美食与夜生活的缤纷体验。",
    image:
      "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "自然冒险",
    description: "远离喧嚣的山林秘境，感受户外的蓬勃生命力。",
    image:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80"
  }
];

export function DestinationGallery() {
  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl">
      <header className="flex flex-col gap-2">
        <span className="text-sm uppercase tracking-[0.24em] text-slate-400">Inspiration</span>
        <h2 className="text-2xl font-semibold text-white">灵感画廊</h2>
        <p className="text-sm text-slate-400">
          精选旅行瞬间助你构想下一次出行，AI 行程会根据你的偏好生成更贴合的安排。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {GALLERY.map((item) => (
          <article
            key={item.title}
            className="group relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/40"
          >
            <Image
              src={item.image}
              alt={item.title}
              width={600}
              height={400}
              className="h-48 w-full object-cover transition duration-700 group-hover:scale-110"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 space-y-1 p-4">
              <h3 className="text-lg font-semibold text-white">{item.title}</h3>
              <p className="text-xs text-slate-300">{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
