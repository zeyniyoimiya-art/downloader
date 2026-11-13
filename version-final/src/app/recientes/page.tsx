"use client";
// "/recientes": fichas de vidrio con búsqueda, filtros, menú contextual, preview local (Range) y parallax de carátulas.
import { useEffect, useMemo, useState } from "react";
import { Search, FolderOpen, Copy, RotateCcw, Trash2, Music2, Film, Image as ImageIcon, Headphones } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Panel } from "@/components/ui";
import { fmtBytes, fmtDuration } from "@/lib/shared/progress";
import { sfx } from "@/lib/client/sound";
import type { HistoryView } from "@/lib/client/types";

export default function Recientes() {
  const { toast } = useApp();
  const [items, setItems] = useState<HistoryView[] | null>(null);
  const [q, setQ] = useState("");
  const [site, setSite] = useState("todos");
  const [fmt, setFmt] = useState("todos");
  const [menu, setMenu] = useState<{ x: number; y: number; item: HistoryView } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [scrollY, setScrollY] = useState(0);

  const load = () => fetch("/api/history").then((r) => r.json()).then(setItems);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const on = () => setScrollY(scrollY0());
    const scrollY0 = () => window.scrollY;
    const close = () => setMenu(null);
    addEventListener("scroll", on, { passive: true }); addEventListener("click", close);
    return () => { removeEventListener("scroll", on); removeEventListener("click", close); };
  }, []);

  const sites = useMemo(() => ["todos", ...new Set((items ?? []).map((i) => i.source))], [items]);
  const fmts = useMemo(() => ["todos", ...new Set((items ?? []).map((i) => i.format))], [items]);
  const list = useMemo(() => (items ?? []).filter((i) =>
    (site === "todos" || i.source === site) && (fmt === "todos" || i.format === fmt) &&
    (!q || `${i.title} ${i.author} ${i.url}`.toLowerCase().includes(q.toLowerCase()))), [items, q, site, fmt]);

  const act = async (kind: string, it: HistoryView) => {
    sfx.pop(); setMenu(null);
    if (kind === "open") await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) });
    if (kind === "play") { const r = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, play: true }) }); if (!r.ok) toast({ kind: "err", title: "ffplay no disponible" }); }
    if (kind === "copy") { await navigator.clipboard.writeText(it.path); toast({ kind: "info", title: "Ruta copiada" }); }
    if (kind === "redo") {
      const fmtOk = /^[a-z0-9]{2,8}$/.test(it.format) ? it.format : "mp4";
      await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: [it.url], mode: ["audio", "video", "photo", "profile"].includes(it.mode) ? it.mode : "video", format: fmtOk, quality: "best" }) });
      toast({ kind: "info", title: "Re-bajando", body: it.title });
    }
    if (kind === "del") { await fetch(`/api/history?id=${it.id}`, { method: "DELETE" }); setItems((x) => x?.filter((y) => y.id !== it.id) ?? null); }
  };

  // Clasificar por la extensión REAL del archivo en disco (it.path), no por el
  // format guardado: el historial podía catalogar un .m4a como "mov" y la tarjeta
  // lo metía en un <video> (cuadro negro). La ruta es la ground truth.
  const ext = (p: string) => (p.split(".").pop() || "").toLowerCase();
  const isVideo = (it: HistoryView) => ["mp4", "mkv", "webm", "mov", "m4v", "avi"].includes(ext(it.path));
  const isAudio = (it: HistoryView) => ["mp3", "m4a", "aac", "flac", "wav", "opus", "ogg"].includes(ext(it.path));
  const isAV = (it: HistoryView) => isVideo(it) || isAudio(it);
  // El <video> del navegador no decodifica .mkv (ni siempre .mov): en vez de un
  // cuadro negro mudo, avisamos y ofrecemos abrirlo en el reproductor del sistema.
  const needsExternal = (it: HistoryView) => isVideo(it) && !["mp4", "webm", "mov", "m4v"].includes(ext(it.path));

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-4xl font-bold tracking-[-0.035em]">Recientes</h1>
        <p className="muted mt-1 text-sm">Tu historial vive en <span className="mono">history.json</span>, en esta máquina.</p>
      </div>
      <Panel className="flex flex-wrap items-center gap-3 p-3">
        <label className="scrim flex min-w-56 flex-1 items-center gap-2 border border-white/10 px-3 py-2 sq-pill">
          <Search size={16} strokeWidth={1.5} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar título, autor o link" className="w-full bg-transparent text-sm outline-none" aria-label="Buscar" />
        </label>
        <select value={site} onChange={(e) => setSite(e.target.value)} className="btn btn-glass px-3 py-2 text-sm sq-pill" aria-label="Filtrar por sitio">{sites.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={fmt} onChange={(e) => setFmt(e.target.value)} className="btn btn-glass px-3 py-2 text-sm sq-pill mono" aria-label="Filtrar por formato">{fmts.map((s) => <option key={s}>{s}</option>)}</select>
      </Panel>

      {items === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass skeleton h-64 sq" />)}</div>
      ) : !list.length ? (
        <Panel className="p-12 text-center"><p className="text-lg font-semibold">Nada por aquí todavía</p><p className="muted text-sm">Lo que bajes aparecerá con su ficha completa.</p></Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((it, i) => (
            <article key={it.id} data-tilt onContextMenu={(e) => { e.preventDefault(); sfx.tick(); setMenu({ x: e.clientX, y: e.clientY, item: it }); }}
              className="glass rise group overflow-hidden sq transition-shadow hover:shadow-[0_30px_60px_-20px_rgba(168,85,247,.5)]" style={{ animationDelay: `${Math.min(i, 12) * 55}ms` }}>
              <div className="relative aspect-video overflow-hidden bg-black/30">
                {playing === it.id && isAV(it) ? (
                  (needsExternal(it) || mediaErr === it.id) ? (
                    <div className="grid h-full place-items-center gap-3 p-4 text-center">
                      <p className="muted text-xs">{mediaErr === it.id ? "El navegador no pudo decodificar" : "El navegador no reproduce"} <span className="mono uppercase">{ext(it.path)}</span> aquí.</p>
                      <button onClick={() => act("open", it)} className="btn btn-glass sq-pill px-3 py-1.5 text-xs"><FolderOpen size={14} /> Abrir en reproductor</button>
                    </div>
                  ) : isVideo(it) ? <video src={`/api/media?id=${it.id}`} controls autoPlay playsInline className="h-full w-full bg-black" onError={() => setMediaErr(it.id)} /> : <div className="grid h-full place-items-center p-4"><audio src={`/api/media?id=${it.id}`} controls autoPlay className="w-full" onError={() => setMediaErr(it.id)} /></div>
                ) : it.thumbnail ? (
                  <img src={it.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-[120%] w-full object-cover transition-transform duration-700 group-hover:scale-105" style={{ transform: `translateY(${-((scrollY * 0.04 + i * 3) % 20)}px)` }} />
                ) : (
                  <div className="grid h-full place-items-center bg-gradient-to-br from-violet-500/30 to-pink-500/20">{isVideo(it) ? <Film size={36} strokeWidth={1} /> : isAV(it) ? <Music2 size={36} strokeWidth={1} /> : <ImageIcon size={36} strokeWidth={1} />}</div>
                )}
                {isAV(it) && playing !== it.id && <button onClick={() => { sfx.pop(); setMediaErr(null); setPlaying(it.id); }} className="btn absolute bottom-3 left-3 h-10 w-10 rounded-full bg-white/90 text-black opacity-0 group-hover:opacity-100" aria-label="Reproducir">▶</button>}
                <span className="mono absolute right-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] uppercase text-white">{it.format}</span>
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 text-sm font-semibold">{it.title}</h3>
                <dl className="muted mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <dt>Autor</dt><dd className="truncate text-right">{it.author || "—"}</dd>
                  <dt>Fecha</dt><dd className="text-right">{it.date ? `${it.date.slice(0, 4)}-${it.date.slice(4, 6)}-${it.date.slice(6, 8)}` : new Date(it.createdAt).toLocaleDateString()}</dd>
                  <dt>Fuente</dt><dd className="text-right">{it.source}</dd>
                  <dt>Peso · duración</dt><dd className="mono text-right">{fmtBytes(it.size)} · {fmtDuration(it.duration)}</dd>
                </dl>
                <div className="mt-3 flex gap-1.5">
                  <button onClick={() => act("open", it)} className="btn btn-glass h-8 flex-1 text-xs sq-pill" aria-label="Abrir carpeta"><FolderOpen size={14} /></button>
                  <button onClick={() => act("copy", it)} className="btn btn-glass h-8 flex-1 text-xs sq-pill" aria-label="Copiar ruta"><Copy size={14} /></button>
                  <button onClick={() => act("redo", it)} className="btn btn-glass h-8 flex-1 text-xs sq-pill" aria-label="Re-bajar"><RotateCcw size={14} /></button>
                  <button onClick={() => act("del", it)} className="btn btn-glass h-8 flex-1 text-xs sq-pill" aria-label="Eliminar del historial"><Trash2 size={14} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Menú contextual de vidrio */}
      {menu && (
        <div role="menu" className="glass glass-strong banner-in fixed z-[80] w-56 p-1.5 sq-sm" style={{ left: Math.min(menu.x, innerWidth - 240), top: Math.min(menu.y, innerHeight - 240) }} onClick={(e) => e.stopPropagation()}>
          {[["open", "Abrir carpeta", FolderOpen], ["play", "Escucha rápida (ffplay)", Headphones], ["copy", "Copiar ruta", Copy], ["redo", "Re-bajar", RotateCcw], ["del", "Eliminar del historial", Trash2]].map(([k, l, I]) => {
            const Icon = I as typeof Copy;
            return <button key={k as string} role="menuitem" onClick={() => act(k as string, menu.item)} className={`btn w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm font-normal hover:bg-white/10 ${k === "del" ? "text-rose-300" : ""}`}><Icon size={15} strokeWidth={1.5} />{l as string}</button>;
          })}
        </div>
      )}
    </div>
  );
}
