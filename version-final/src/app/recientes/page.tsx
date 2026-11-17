"use client";
/* eslint-disable @next/next/no-img-element --
   Aquí las imágenes NO son recursos del sitio: son los archivos del usuario,
   servidos por /api/thumb (miniatura local) o /api/media (original).
*/
// "/recientes": fichas con búsqueda, filtros, menú contextual, preview local,
// vista ampliada de las fotos y ficha técnica del archivo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, FolderOpen, Copy, RotateCcw, Trash2, Music2, Film, Image as ImageIcon, Headphones, AlertTriangle, X, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Panel } from "@/components/ui";
import { fmtBytes, fmtDuration } from "@/lib/shared/progress";
import { sfx } from "@/lib/client/sound";
import type { HistoryView } from "@/lib/client/types";

// Clasificación por la extensión REAL del archivo en disco (it.path), no por el
// format guardado: el historial podía catalogar un .m4a como "mov" y la tarjeta
// lo metía en un <video> (cuadro negro). La ruta es la ground truth.
const ext = (p: string) => (p.split(".").pop() || "").toLowerCase();
const EXT_VIDEO = ["mp4", "mkv", "webm", "mov", "m4v", "avi", "ts", "flv"];
const EXT_AUDIO = ["mp3", "m4a", "aac", "flac", "wav", "opus", "ogg", "aiff", "mka"];
const EXT_IMG = ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tiff", "tif", "heic"];
const isVideo = (it: HistoryView) => EXT_VIDEO.includes(ext(it.path));
const isAudio = (it: HistoryView) => EXT_AUDIO.includes(ext(it.path));
const isAV = (it: HistoryView) => isVideo(it) || isAudio(it);
const isImg = (it: HistoryView) => EXT_IMG.includes(ext(it.path));
// El <video> del navegador no decodifica .mkv (ni siempre .mov): en vez de un
// cuadro negro mudo, avisamos y ofrecemos abrirlo en el reproductor del sistema.
const needsExternal = (it: HistoryView) => isVideo(it) && !["mp4", "webm", "mov", "m4v"].includes(ext(it.path));

/**
 * Miniatura de una ficha.
 *
 * El fallo que arregla: antes sólo se usaba `it.thumbnail`, la URL del sitio de
 * origen. En una foto de Instagram eso es una URL firmada que caduca y un CDN
 * que exige cabeceras → nunca cargaba y quedaba el icono. Ahora se pide a
 * /api/thumb, que la genera DEL ARCHIVO LOCAL (y la cachea), y sólo si eso no
 * existe se prueba la URL remota. Las fotos se ven enteras: `object-contain`.
 */
function Miniatura({ it, i, scrollY, onAmpliar }: { it: HistoryView; i: number; scrollY: number; onAmpliar: () => void }) {
  const local = `/api/thumb?id=${it.id}&w=900`;
  const [src, setSrc] = useState<string | null>(isAV(it) ? (it.thumbnail || local) : local);
  const [rota, setRota] = useState(false);

  const alFallar = () => {
    // Remota → local; local → icono (sin bucles de reintento).
    if (src && src !== local) setSrc(local);
    else setRota(true);
  };

  if (isImg(it)) {
    return (
      <button
        onClick={onAmpliar}
        className="relative block h-[200px] w-full overflow-hidden bg-[var(--fill)]"
        aria-label={`Ver ${it.title} en grande`}
        title="Ver en grande"
      >
        {rota ? (
          <span className="grid h-full place-items-center"><ImageIcon size={36} strokeWidth={1} /></span>
        ) : (
          <img
            src={src ?? local}
            alt={it.title}
            loading="lazy"
            decoding="async"
            onError={alFallar}
            /* `contain`, no `cover`: una foto cuadrada es cuadrada. Recortarla a
               16:9 era justo lo que hacía que se viera «aplastada». */
            className="h-full w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
          />
        )}
        <span className="mono absolute bottom-2 right-2 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] uppercase text-white">
          {ext(it.path)}
        </span>
      </button>
    );
  }

  if (rota || !src) {
    return (
      <div className="grid h-full place-items-center bg-[linear-gradient(150deg,color-mix(in_oklab,var(--acento)_16%,transparent),rgba(255,255,255,.02))]">
        {isVideo(it) ? <Film size={36} strokeWidth={1} /> : isAV(it) ? <Music2 size={36} strokeWidth={1} /> : <ImageIcon size={36} strokeWidth={1} />}
      </div>
    );
  }
  return (
    <img
      loading="lazy"
      decoding="async"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={alFallar}
      className="h-[120%] w-full object-cover transition-transform duration-700 group-hover:scale-105"
      style={{ transform: `translateY(${-((scrollY * 0.04 + i * 3) % 20)}px)` }}
    />
  );
}

interface FichaInfo {
  existe: boolean;
  tamano?: number;
  info?: {
    duracion: number; formato: string; bitrate: number;
    audio?: { codec: string; canales?: number; hz?: number; kbps?: number };
    video?: { codec: string; ancho: number; alto: number; fps?: number };
    cover: boolean; coverTamano?: { ancho: number; alto: number; codec: string };
    etiquetas: Record<string, string>;
  } | null;
  historial?: { titulo: string; autor: string; fuente: string; formato: string; duracion: number };
  error?: string;
}

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
  const [reparando, setReparando] = useState(false);
  const [zoom, setZoom] = useState<HistoryView | null>(null);
  const [ficha, setFicha] = useState<{ item: HistoryView; datos: FichaInfo | null; cargando: boolean } | null>(null);

  const load = (revisar = false) => fetch(`/api/history${revisar ? "?revisar=1" : ""}`).then((r) => r.json()).then(setItems);

  // «Reconectar»: repasa el historial y corrige las rutas que se quedaron
  // viejas (otra carpeta de salida, nombre que el motor escribió distinto…).
  const reparar = async () => {
    setReparando(true); sfx.pop();
    try {
      const r = await fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: "{}" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast({ kind: "err", title: "No se pudo revisar", body: d.error });
      else toast({ kind: d.corregidas ? "ok" : "info", title: d.corregidas ? "Rutas corregidas" : "Todo en su sitio", body: d.mensaje });
      await load(true);
    } finally { setReparando(false); }
  };

  const abrirFicha = useCallback(async (it: HistoryView) => {
    sfx.tick();
    setFicha({ item: it, datos: null, cargando: true });
    try {
      const r = await fetch(`/api/info?id=${it.id}`);
      const d = await r.json().catch(() => ({}));
      setFicha({ item: it, datos: r.ok ? d : { existe: false, error: d.error }, cargando: false });
    } catch {
      setFicha({ item: it, datos: { existe: false, error: "no se pudo leer la ficha" }, cargando: false });
    }
  }, []);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const on = () => setScrollY(window.scrollY);
    const close = () => setMenu(null);
    addEventListener("scroll", on, { passive: true }); addEventListener("click", close);
    return () => { removeEventListener("scroll", on); removeEventListener("click", close); };
  }, []);
  // Esc cierra la vista ampliada y la ficha (antes no había forma de cerrarlas
  // con el teclado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setZoom(null); setFicha(null); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const sites = useMemo(() => ["todos", ...new Set((items ?? []).map((i) => i.source))], [items]);
  const fmts = useMemo(() => ["todos", ...new Set((items ?? []).map((i) => i.format))], [items]);
  const list = useMemo(() => (items ?? []).filter((i) =>
    (site === "todos" || i.source === site) && (fmt === "todos" || i.format === fmt) &&
    (!q || `${i.title} ${i.author} ${i.url}`.toLowerCase().includes(q.toLowerCase()))), [items, q, site, fmt]);

  const act = async (kind: string, it: HistoryView) => {
    sfx.pop(); setMenu(null);
    if (kind === "open") {
      const r = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ id: it.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast({ kind: "err", title: "No se pudo abrir", body: d.error });
      else if (d.aviso) toast({ kind: "info", title: "El archivo ya no está", body: d.aviso });
    }
    if (kind === "play") { const r = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ id: it.id, play: true }) }); if (!r.ok) toast({ kind: "err", title: "ffplay no disponible" }); }
    if (kind === "copy") { await navigator.clipboard.writeText(it.path); toast({ kind: "info", title: "Ruta copiada" }); }
    if (kind === "redo") {
      const fmtOk = /^[a-z0-9]{2,8}$/.test(it.format) ? it.format : "mp4";
      const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ urls: [it.url], mode: ["audio", "video", "photo", "profile"].includes(it.mode) ? it.mode : "video", format: fmtOk, quality: "best" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) toast({ kind: "err", title: "No se pudo re-bajar", body: d.error });
      else if (d.rejected?.length) toast({ kind: "err", title: "Ese link ya no vale", body: d.rejected[0] });
      else toast({ kind: "info", title: "Re-bajando", body: it.title });
    }
    if (kind === "del") { await fetch(`/api/history?id=${it.id}`, { method: "DELETE", headers: { "x-linyue": "1" } }); setItems((x) => x?.filter((y) => y.id !== it.id) ?? null); }
  };

  // Navegación entre fotos dentro de la vista ampliada.
  const vecinas = useMemo(() => list.filter(isImg), [list]);
  const mover = (delta: number) => {
    if (!zoom) return;
    const i = vecinas.findIndex((v) => v.id === zoom.id);
    const n = vecinas[(i + delta + vecinas.length) % Math.max(1, vecinas.length)];
    if (n) { sfx.tick(); setZoom(n); }
  };

  return (
    <div className="space-y-6">
      <div className="rise">
        <p className="label" style={{ color: "var(--accent-ink)" }}>Historial</p><h1 className="display mt-2 text-[2.4rem]">Recientes</h1>
        <p className="muted mt-1 text-sm">Tu historial vive en <span className="mono">history.json</span>, en esta máquina.</p>
      </div>
      <Panel className="flex flex-wrap items-center gap-3 p-3">
        <label className="scrim flex min-w-56 flex-1 items-center gap-2 border border-[var(--line)] px-3 py-2 sq-pill">
          <Search size={16} strokeWidth={1.5} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar título, autor o link" className="w-full bg-transparent text-sm outline-none" aria-label="Buscar" />
        </label>
        <select value={site} onChange={(e) => setSite(e.target.value)} className="btn btn-glass px-3 py-2 text-sm sq-pill" aria-label="Filtrar por sitio">{sites.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={fmt} onChange={(e) => setFmt(e.target.value)} className="btn btn-glass px-3 py-2 text-sm sq-pill mono" aria-label="Filtrar por formato">{fmts.map((s) => <option key={s}>{s}</option>)}</select>
        <button onClick={reparar} disabled={reparando} className="btn btn-glass px-3 py-2 text-sm sq-pill" aria-label="Revisar rutas del historial" title="Busca en la carpeta de salida los archivos que el historial da por perdidos y corrige su ruta">
          <RotateCcw size={14} className={reparando ? "animate-spin" : "ico"} /><span className="hidden sm:inline">{reparando ? "Revisando…" : "Reconectar"}</span>
        </button>
      </Panel>

      {items === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass skeleton h-64 sq" />)}</div>
      ) : !list.length ? (
        <Panel className="p-12 text-center"><p className="text-lg font-semibold">Nada por aquí todavía</p><p className="muted text-sm">Lo que bajes aparecerá con su ficha completa.</p></Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((it, i) => (
            <article key={it.id} data-tilt onContextMenu={(e) => { e.preventDefault(); sfx.tick(); setMenu({ x: e.clientX, y: e.clientY, item: it }); }}
              className="glass rise group overflow-hidden sq transition-shadow hover:shadow-[0_30px_60px_-20px_color-mix(in_oklab,var(--acento)_45%,transparent)]" style={{ animationDelay: `${Math.min(i, 12) * 55}ms` }}>
              <div className="relative aspect-video overflow-hidden bg-black/30">
                {playing === it.id && isAV(it) ? (
                  (needsExternal(it) || mediaErr === it.id) ? (
                    <div className="grid h-full place-items-center gap-3 p-4 text-center">
                      <p className="muted text-xs">{mediaErr === it.id ? "El navegador no pudo decodificar" : "El navegador no reproduce"} <span className="mono uppercase">{ext(it.path)}</span> aquí.</p>
                      <button onClick={() => act("open", it)} className="btn btn-glass sq-pill px-3 py-1.5 text-xs"><FolderOpen size={14} /> Abrir en reproductor</button>
                    </div>
                  ) : isVideo(it) ? <video src={`/api/media?id=${it.id}`} controls autoPlay playsInline className="h-full w-full bg-black" onError={() => setMediaErr(it.id)} /> : <div className="grid h-full place-items-center p-4"><audio src={`/api/media?id=${it.id}`} controls autoPlay className="w-full" onError={() => setMediaErr(it.id)} /></div>
                ) : (
                  <Miniatura it={it} i={i} scrollY={scrollY} onAmpliar={() => setZoom(it)} />
                )}
                {isAV(it) && playing !== it.id && <button onClick={() => { sfx.pop(); setMediaErr(null); setPlaying(it.id); }} className="btn absolute bottom-3 left-3 h-10 w-10 rounded-full bg-white/90 text-black opacity-0 group-hover:opacity-100" aria-label="Reproducir">▶</button>}
                {/* La ficha técnica: qué códec, qué bitrate y TODAS las etiquetas
                    que lleva dentro (así se comprueba que la letra y la portada
                    están de verdad, sin abrir otro programa). */}
                <button onClick={() => abrirFicha(it)} className="btn absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100" aria-label="Ficha del archivo" title="Metadatos del archivo">
                  <Info size={14} />
                </button>
                <span className="mono absolute left-3 top-3 rounded-lg bg-black/60 px-2 py-0.5 text-[11px] uppercase text-white group-hover:hidden">{it.format}</span>
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 text-sm font-semibold">{it.title}</h3>
                {it.existe === false && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--warn-ink)" }} title={it.path}>
                    <AlertTriangle size={12} strokeWidth={2} />El archivo ya no está en esa ruta
                  </div>
                )}
                <dl className="muted mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <dt>Autor</dt><dd className="truncate text-right">{it.author || "—"}</dd>
                  <dt>Fecha</dt><dd className="text-right">{it.date ? `${it.date.slice(0, 4)}-${it.date.slice(4, 6)}-${it.date.slice(6, 8)}` : new Date(it.createdAt).toLocaleDateString()}</dd>
                  <dt>Fuente</dt><dd className="truncate text-right">{it.source}</dd>
                  <dt>Peso · duración</dt><dd className="mono text-right">{it.size > 0 ? fmtBytes(it.size) : "—"} · {it.duration > 0 ? fmtDuration(it.duration) : "—"}</dd>
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

      {/* ── Vista ampliada de una foto: el archivo ORIGINAL, sin recortes ── */}
      {zoom && (
        <div role="dialog" aria-modal="true" aria-label={zoom.title} onClick={() => setZoom(null)}
          className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="relative max-h-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <img src={`/api/media?id=${zoom.id}`} alt={zoom.title} className="max-h-[86vh] w-auto max-w-full object-contain" />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="truncate text-xs text-white/80">{zoom.title}</p>
              <button onClick={() => setZoom(null)} className="btn sq-pill bg-white/10 px-3 py-1 text-xs text-white" aria-label="Cerrar"><X size={14} /></button>
            </div>
            {vecinas.length > 1 && (
              <>
                <button onClick={() => mover(-1)} className="btn absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white" aria-label="Foto anterior"><ChevronLeft size={18} /></button>
                <button onClick={() => mover(1)} className="btn absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white" aria-label="Foto siguiente"><ChevronRight size={18} /></button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Ficha técnica ── */}
      {ficha && (
        <div role="dialog" aria-modal="true" aria-label="Ficha del archivo" onClick={() => setFicha(null)}
          className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-3">
          <div onClick={(e) => e.stopPropagation()} className="glass glass-strong banner-in max-h-[86vh] w-full overflow-auto p-5 sq sm:max-w-lg">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label" style={{ color: "var(--accent-ink)" }}>Ficha del archivo</p>
                <h2 className="mt-1 truncate text-base font-semibold">{ficha.item.title}</h2>
              </div>
              <button onClick={() => setFicha(null)} className="btn btn-glass h-8 w-8 sq-pill" aria-label="Cerrar ficha"><X size={15} /></button>
            </div>
            {ficha.cargando ? (
              <p className="muted text-sm">Leyendo el archivo…</p>
            ) : !ficha.datos?.info ? (
              <p className="text-sm" style={{ color: "var(--danger-ink)" }}>{ficha.datos?.error ?? "No se pudo leer el archivo (¿falta ffprobe?)."}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <dt className="muted">Formato</dt><dd className="mono text-right">{ficha.datos.info.video ? `${ficha.datos.info.video.codec} · ${ficha.datos.info.video.ancho}×${ficha.datos.info.video.alto}${ficha.datos.info.video.fps ? ` · ${ficha.datos.info.video.fps} fps` : ""}` : ficha.datos.info.audio?.codec}</dd>
                  <dt className="muted">Audio</dt><dd className="mono text-right">{ficha.datos.info.audio ? `${ficha.datos.info.audio.codec}${ficha.datos.info.audio.kbps ? ` · ${ficha.datos.info.audio.kbps} kbps` : ""}${ficha.datos.info.audio.hz ? ` · ${ficha.datos.info.audio.hz} Hz` : ""}${ficha.datos.info.audio.canales ? ` · ${ficha.datos.info.audio.canales} can.` : ""}` : "—"}</dd>
                  <dt className="muted">Duración</dt><dd className="mono text-right">{ficha.datos.info.duracion ? fmtDuration(ficha.datos.info.duracion) : "—"}</dd>
                  <dt className="muted">Tamaño</dt><dd className="mono text-right">{ficha.datos.tamano ? fmtBytes(ficha.datos.tamano) : "—"}</dd>
                  <dt className="muted">Carátula</dt><dd className="text-right">{ficha.datos.info.cover ? <span style={{ color: "var(--ok-ink)" }}>sí{ficha.datos.info.coverTamano ? ` · ${ficha.datos.info.coverTamano.ancho}×${ficha.datos.info.coverTamano.alto}` : ""}</span> : <span className="muted">no</span>}</dd>
                </dl>
                <p className="label mt-4 mb-1.5">Etiquetas</p>
                {Object.keys(ficha.datos.info.etiquetas).filter((k) => !["encoder", "ENCODER", "major_brand", "minor_version", "compatible_brands", "handler_name", "vendor_id", "DURATION"].includes(k)).length === 0 ? (
                  <p className="muted text-xs">El archivo no lleva etiquetas. Activa «Etiquetas completas» en Ajustes y vuelve a bajarlo.</p>
                ) : (
                  <dl className="grid gap-1 text-xs">
                    {Object.entries(ficha.datos.info.etiquetas)
                      .filter(([k]) => !["encoder", "ENCODER", "major_brand", "minor_version", "compatible_brands", "handler_name", "vendor_id", "DURATION"].includes(k))
                      .map(([k, v]) => (
                        <div key={k} className="flex items-start gap-3 border-b border-[var(--line)] pb-1 last:border-0">
                          <dt className="mono muted w-28 shrink-0 text-[11px] uppercase">{k}</dt>
                          <dd className="min-w-0 flex-1 break-words" style={{ whiteSpace: "pre-wrap" }}>{v.length > 400 ? `${v.slice(0, 400)}… (${v.length} caracteres)` : v}</dd>
                        </div>
                      ))}
                  </dl>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Menú contextual de vidrio */}
      {menu && (
        <div role="menu" className="glass glass-strong banner-in fixed z-[80] w-56 p-1.5 sq-sm" style={{ left: Math.min(menu.x, innerWidth - 240), top: Math.min(menu.y, innerHeight - 240) }} onClick={(e) => e.stopPropagation()}>
          {[["open", "Abrir carpeta", FolderOpen], ["play", "Escucha rápida (ffplay)", Headphones], ["info", "Metadatos del archivo", Info], ["copy", "Copiar ruta", Copy], ["redo", "Re-bajar", RotateCcw], ["del", "Eliminar del historial", Trash2]].map(([k, l, I]) => {
            const Icon = I as typeof Copy;
            return <button key={k as string} role="menuitem" onClick={() => (k === "info" ? abrirFicha(menu.item) : act(k as string, menu.item))} className={`btn w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-sm font-normal hover:bg-[var(--fill-2)] ${k === "del" ? "text-[var(--danger-ink)]" : ""}`}><Icon size={15} strokeWidth={1.5} />{l as string}</button>;
          })}
        </div>
      )}
    </div>
  );
}
