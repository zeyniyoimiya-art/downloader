"use client";
/* eslint-disable @next/next/no-img-element --
   Las carátulas vienen de decenas de dominios (YouTube, TikTok, X, Bilibili…). Con <Image> habría que abrir `remotePatterns` a '**', que es exactamente lo que la regla evita. Se compensa con loading=lazy, decoding=async y un contenedor aspect-video (sin CLS).
*/
// "/" Descargador: hero, textarea multi-link con chips por línea, modos, formatos (FLIP), vista previa y cola viva.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FolderOpen, Music2, Film, Images, UserSquare2, GripVertical, RotateCcw, X, Pause, Play, Trash2, Sparkles, Loader2, Clock, Moon, Scissors, Radio, Plus } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Odometer, Panel, Ring } from "@/components/ui";
import { parseLinks, routeEngine, primaryMode, availableModes, recommendMode, AUDIO_FORMATS, VIDEO_FORMATS, PHOTO_FORMATS } from "@/lib/shared/platforms";
import type { VideoCodec } from "@/lib/shared/codecs";
import { fmtBytes, fmtDuration, fmtViews } from "@/lib/shared/progress";
import { sfx } from "@/lib/client/sound";
import type { ConfigView, Mode } from "@/lib/client/types";
import { describirRevision, type Sub } from "@/lib/shared/subs";

const MODES: { id: Mode; title: string; desc: string; icon: typeof Music2; grad: string }[] = [
  { id: "all", title: "Todo", desc: "Fotos + Video + Audio", icon: Sparkles, grad: "grad-red" },
  { id: "photo_video", title: "Fotos + Video", desc: "Galería y clips del post", icon: Images, grad: "grad-red" },
  { id: "audio_photo", title: "Audio + Fotos", desc: "Música y carátulas", icon: Music2, grad: "grad-red" },
  { id: "audio", title: "Música y audio", desc: "M4A · MP3 · FLAC · WAV · OPUS", icon: Music2, grad: "grad-red" },
  { id: "video", title: "Video", desc: "MP4 · MKV · WEBM hasta 8K", icon: Film, grad: "grad-red" },
  { id: "photo", title: "Fotos y galería", desc: "Originales o WEBP/JPG", icon: Images, grad: "grad-red" },
  { id: "profile", title: "Perfil completo", desc: "Canal, cuenta o lista", icon: UserSquare2, grad: "grad-red" },
];
const FORMATS: Record<Mode, readonly string[]> = {
  audio: AUDIO_FORMATS, video: VIDEO_FORMATS, photo: PHOTO_FORMATS,
  profile: [...VIDEO_FORMATS, "mp3", "m4a"],
  all: VIDEO_FORMATS, photo_video: VIDEO_FORMATS, audio_photo: AUDIO_FORMATS,
};
// Resoluciones que existen de verdad (144p de los vídeos viejos incluida).
// Programador (fase 8): retrasar el arranque sin cerrar la app. 0 = ahora.
// No es un cron: el trabajo queda en la cola persistente y arranca solo cuando
// llega su hora, aunque cierres y vuelvas a abrir la app.
// SponsorBlock (fase 9): marcar o quitar patrocinios sin abrir el vídeo.
const SPONSOR: { id: "off" | "marcar" | "quitar"; label: string; title: string }[] = [
  { id: "off", label: "No", title: "deja el vídeo tal cual" },
  { id: "marcar", label: "Marcar", title: "los marca como capítulos, no corta nada" },
  { id: "quitar", label: "Quitar", title: "quita patrocinio, autopromoción, intro y outro" },
];
const DELAYS: { min: number; label: string }[] = [
  { min: 0, label: "Ahora" },
  { min: 15, label: "15 min" },
  { min: 60, label: "1 h" },
  { min: 180, label: "3 h" },
];
const QUALITIES = ["best", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"];
// Códecs ofrecidos en el propio descargador (los 5 que sirven los sitios;
// ProRes/Theora solo tienen sentido recodificando y viven en Ajustes).
const CODECS: { id: VideoCodec; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "el mejor que ofrezca el sitio" },
  { id: "h264", label: "H.264", title: "compatible con todo (TV, móvil, Windows)" },
  { id: "h265", label: "H.265", title: "HEVC: ~40 % menos peso" },
  { id: "av1", label: "AV1", title: "el más eficiente" },
  { id: "vp9", label: "VP9", title: "el estándar de YouTube" },
];

interface Preview { url: string; platform: string; color: string; engine: string; title?: string; author?: string; duration?: number; thumbnail?: string; heights?: number[]; error?: string; note?: string; entries?: number; date?: string; views?: number; size?: number }

export default function Home() {
  const { jobs, toast, jobAction } = useApp();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mode | null>(null); // modo elegido a mano (null = seguir recomendación)
  const [format, setFormat] = useState("mp3");
  const [quality, setQuality] = useState("1080");
  const [codec, setCodec] = useState<VideoCodec>("auto");
  const [delay, setDelay] = useState(0); // minutos de retraso elegidos en la home
  const [sponsor, setSponsor] = useState<"off" | "marcar" | "quitar" | null>(null); // null = lo que diga Ajustes
  const [recorte, setRecorte] = useState(""); // "1:00-2:30" · vacío = el vídeo entero
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [status, setStatus] = useState<{ files: number; outputDir: string; freeBytes?: number | null; freeLabel?: string | null }>({ files: 0, outputDir: "" });
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  // Segundos que lleva «Inspeccionando…»: si tarda, el usuario ve que avanza.
  const [esperando, setEsperando] = useState(0);
  const links = useMemo(() => parseLinks(text), [text]);
  // Modos con sentido para los links pegados + el recomendado (preselección).
  const avail = useMemo(() => availableModes(links), [links]);
  const rec = useMemo(() => recommendMode(links), [links]);
  // Modo efectivo DERIVADO (sin effects): si el usuario eligió uno y sigue siendo
  // válido lo respetamos; si no, caemos al recomendado o al primero disponible.
  const mode: Mode = picked && avail.includes(picked) ? picked : (avail.includes(rec) ? rec : avail[0] ?? "audio");
  const defaultFormatFor = (m: Mode) => {
    const key = primaryMode(m);
    const def = key === "audio" ? cfg?.audioFormat : key === "photo" ? cfg?.photoFormat : cfg?.videoFormat;
    return def && FORMATS[m].includes(def) ? def : FORMATS[m][0];
  };
  // Formato efectivo: el elegido si encaja en el modo activo; si no, su default.
  const effFormat = FORMATS[mode].includes(format) ? format : defaultFormatFor(mode);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((c: ConfigView) => { setCfg(c); setFormat(c.audioFormat); setQuality(c.videoQuality); setCodec(c.videoCodec); });
  }, []);
  // Refresca el conteo de archivos cuando cambia la cola
  const doneCount = jobs.filter((j) => j.state === "done").length;
  useEffect(() => { fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {}); }, [doneCount]);

  const pickMode = (m: Mode) => {
    sfx.pop(); setPicked(m);
    setFormat(defaultFormatFor(m));
  };

  const download = async () => {
    if (!links.length) return toast({ kind: "err", title: "Pega al menos un link válido" });
    sfx.pop(); setBusy(true);
    const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({
      urls: links.map((l) => l.url), mode, format: effFormat, quality, codec, delayMin: delay,
      sponsorblock: sponsor ?? cfg?.sponsorblock, splitChapters: cfg?.splitChapters,
      // El recorte se valida en el servidor; aquí solo se manda si tiene pinta.
      sections: recorte.trim() ? recorte.trim() : undefined,
    }) });
    const d = await r.json(); setBusy(false);
    if (!r.ok) return toast({ kind: "err", title: "No se pudo encolar", body: d.error });
    const skipped = d.added.filter((j: { state: string }) => j.state === "skipped").length;
    const rej: string[] = d.rejected ?? [];
    toast({ kind: rej.length && !d.added.length ? "err" : "info", title: `${d.added.length - skipped} en cola`, body: [
      skipped ? `${skipped} ya estaban descargados (dedup)` : "",
      rej.length ? `Rechazado: ${rej.join(" · ")}` : "",
      delay > 0
        ? `Programado para las ${new Date(Date.now() + delay * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "",
      recorte.trim() ? `Recorte ${recorte.trim()}` : "",
      (sponsor ?? cfg?.sponsorblock) === "quitar" ? "SponsorBlock: quitando patrocinios" : "",
      cfg?.quietEnabled ? `Ventana silenciosa ${cfg.quietFrom}–${cfg.quietTo}: fuera de ella espera` : "",
      "La isla te avisa al terminar",
    ].filter(Boolean).join(" — ") });
    setText(""); setPreviews(null); setDelay(0); setRecorte("");
  };

  // Tope de seguridad (por encima de esto ni la UI ni el sitio aguantan).
  const MAX_PREVIEWS = 60;
  // Concurrencia del sondeo. Antes se recortaba a `links.slice(0, 6)`, así que
  // al pegar 19 links solo salían 6 fichas. Pero lanzar las 19 sondas a la vez
  // satura y YouTube contesta 429: se sondean de 3 en 3, que salen todas y sin
  // bloqueos.
  const PREVIEW_CONCURRENCIA = 3;
  const preview = async () => {
    if (!links.length) return;
    sfx.pop();
    const dest = links.slice(0, MAX_PREVIEWS);
    // Fichas tipo "studio": cada sonda pinta su tarjeta al terminar (van apareciendo)
    setPreviews(dest.map((l) => ({ url: l.url, platform: l.label, color: l.color, engine: routeEngine(l, mode) })));
    setEsperando(0);
    const cola = [...dest];
    const obrero = async () => {
      while (cola.length) {
        const l = cola.shift();
        if (!l) break;
        await fetch("/api/probe", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ url: l.url, mode }) })
          .then((r) => r.json())
          .catch(() => ({ url: l.url, error: "Sin respuesta" }))
          .then((d) => setPreviews((prev) => prev?.map((x) => (x.url === l.url ? { ...x, ...d, url: l.url } : x)) ?? prev));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREVIEW_CONCURRENCIA, dest.length) }, obrero));
  };

  // ── Precalentado de la ficha ─────────────────────────────────────────────
  // Pegar un link y pulsar «Vista previa» costaba lo que tarda yt-dlp en extraer
  // los metadatos: entre 1 y 20 s mirando «Inspeccionando…». Como el link ya se
  // conoce en cuanto se pega, se lanza la sonda en segundo plano (con retardo
  // para no sondear mientras se escribe) y la caché del servidor responde al
  // instante cuando el usuario pulsa. Nunca se muestran esos resultados: solo
  // calientan la caché.
  const yaCalentado = useRef(new Set<string>());
  useEffect(() => {
    const objetivo = links.find((l) => !yaCalentado.current.has(l.url));
    if (!objetivo) return;
    const t = setTimeout(() => {
      yaCalentado.current.add(objetivo.url);
      void fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-linyue": "1" },
        body: JSON.stringify({ url: objetivo.url, mode }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [links, mode]);

  // Atajo Ctrl/Cmd+Enter = descargar.
  // El handler vive en un ref para registrar el listener UNA sola vez: antes el
  // efecto no tenía array de dependencias, así que quitaba y volvía a poner el
  // listener en cada render (y la cola re-renderiza 10 veces por segundo).
  const downloadRef = useRef(download);
  useEffect(() => { downloadRef.current = download; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void downloadRef.current(); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  const anyRunning = jobs.some((j) => j.state === "running" || j.state === "probing");
  const pendientes = previews?.filter((p) => p.title === undefined && !p.error).length ?? 0;
  useEffect(() => {
    // Solo se arranca el cronómetro si hay fichas pendientes; el reinicio a 0 se
    // hace al pintar la siguiente tanda (ver `preview()`), no dentro del efecto:
    // un setState síncrono aquí dispara renders en cascada.
    if (pendientes) {
      const t = setInterval(() => setEsperando((s) => s + 1), 1000);
      return () => clearInterval(t);
    }
  }, [pendientes]);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="rise pt-8 text-center">
        <p className="label" style={{ color: "var(--accent-ink)" }}>Descargador universal · local · sin nube</p>
        <h1 className="display mx-auto mt-5 max-w-3xl text-[2.6rem] sm:text-[4.1rem]" style={{ textWrap: "balance" }}>
          Baja lo que quieras, <span className="grad-text">con ficha completa.</span>
        </h1>
        <p className="muted mx-auto mt-5 max-w-2xl text-base leading-relaxed sm:text-lg">
          Audio, video, fotos y perfiles enteros desde YouTube, TikTok, X, Instagram, Spotify y cientos de sitios más. Autor, fecha, fuente y carátula se incrustan solos; el sistema convierte a MP3, FLAC, WAV, OPUS, MP4, MKV o WEBP cuando lo pidas.
        </p>
      </section>

      {/* Entrada multi-link */}
      <Panel className="rise p-4 sm:p-6" >
        <div className={`absolute inset-x-8 top-0 h-px ${anyRunning ? "lightline" : ""}`} style={{ background: "linear-gradient(90deg,transparent,var(--red),transparent)" }} />
        <div className="relative">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false}
            placeholder={"Pega uno o varios links (uno por línea)…\nhttps://youtu.be/…\nhttps://open.spotify.com/track/…"}
            aria-label="Links a descargar"
            className="mono scrim w-full resize-y p-4 text-sm leading-7 outline-none placeholder:opacity-50 sq-sm border border-[var(--line)]"
          />
        </div>
        {/* Chips de plataforma: cada uno "aterriza" con spring */}
        <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2">
          <span className="glass sq-pill px-3 py-1 text-xs font-semibold"><Odometer value={links.length} /> detectados</span>
          {links.map((l, i) => (
            <span key={l.url} className="land sq-pill flex items-center gap-1.5 border border-[var(--line)] bg-[var(--fill)] px-2.5 py-1 text-xs" style={{ animationDelay: `${i * 50}ms` }} title={l.url}>
              <span className="h-2 w-2 rounded-full" style={{ background: l.color, boxShadow: `0 0 10px ${l.color}` }} />{l.label}
              <span className="mono muted text-[11px]">→ {routeEngine(l, mode, { altEngineCN: cfg?.altEngineCN })}</span>
            </span>
          ))}
        </div>

        {/* Modos: solo los que tienen sentido para los links pegados; el recomendado va primero */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MODES.filter((m) => avail.includes(m.id))
            .sort((a, b) => Number(b.id === rec) - Number(a.id === rec))
            .map((m) => (
              <button key={m.id} data-tilt onClick={() => pickMode(m.id)} aria-pressed={mode === m.id}
                className={`btn glass sq-sm flex-col items-start p-4 text-left ${mode === m.id ? "sel" : "opacity-75"}`}
                style={{ justifyContent: "flex-start" }}>
                <span className={`grid h-10 w-10 place-items-center bg-gradient-to-br ${m.grad} sq-sm`}><m.icon size={20} strokeWidth={1.5} className="ico" /></span>
                <span className="mt-3 flex items-center gap-1.5 text-sm font-semibold">{m.title}{m.id === rec && <span className="mono sq-pill px-1.5 py-0.5 text-[10px] font-bold tracking-widest" style={{ background: "var(--red-wash)", color: "var(--accent-ink)", boxShadow: "inset 0 0 0 1px var(--red-line)" }}>TOP</span>}</span>
                <span className="muted text-[11px] font-normal">{m.desc}</span>
              </button>
            ))}
        </div>

        {/* Formatos con FLIP */}
        <FormatChips formats={FORMATS[mode]} value={effFormat} onChange={(f) => { sfx.tick(); setFormat(f); }} />
        {["video", "profile", "all", "photo_video"].includes(mode) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="muted text-xs">Calidad</span>
            {QUALITIES.map((q) => (
              <button key={q} onClick={() => { sfx.tick(); setQuality(q); }} className={`btn sq-pill px-3 py-1 text-xs mono ${quality === q ? "bg-[var(--fill-2)]" : "btn-glass muted"}`} title={q === "best" ? "la mejor disponible" : `${q}p`}>{q === "best" ? "máx" : q === "4320" ? "8K" : q === "2160" ? "4K" : q + "p"}</button>
            ))}
          </div>
        )}
        {/* Códec: el contenedor es la caja, esto es lo de dentro */}
        {["video", "profile", "all", "photo_video"].includes(mode) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="muted text-xs">Códec</span>
            {CODECS.map((c) => (
              <button key={c.id} onClick={() => { sfx.tick(); setCodec(c.id); }} title={c.title} className={`btn sq-pill px-3 py-1 text-xs mono ${codec === c.id ? "bg-[var(--fill-2)]" : "btn-glass muted"}`}>{c.label}</button>
            ))}
          </div>
        )}

        {/* Recortes: qué se hace con el vídeo al bajarlo */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="muted flex items-center gap-1 text-xs"><Scissors size={13} strokeWidth={1.5} />Recortar</span>
          <input
            value={recorte} onChange={(e) => setRecorte(e.target.value)}
            placeholder="1:00-2:30" aria-label="Recortar por tiempo"
            className="mono w-[124px] px-2.5 py-1 text-xs outline-none sq-pill"
            style={{ background: "var(--fill)", border: "1px solid var(--line)", color: "var(--fg)" }}
            title="Descarga solo ese trozo (vacío = el vídeo entero). Varios: 0:10-0:20, 1:00-1:30"
          />
          <span className="muted mx-1 text-xs">·</span>
          <span className="muted text-xs">SponsorBlock</span>
          {SPONSOR.map((sp) => {
            const activo = (sponsor ?? cfg?.sponsorblock ?? "off") === sp.id;
            return (
              <button key={sp.id} onClick={() => { sfx.tick(); setSponsor(sp.id); }} title={sp.title} aria-pressed={activo}
                className={`btn sq-pill px-3 py-1 text-xs mono ${activo ? "bg-[var(--fill-2)]" : "btn-glass muted"}`}>{sp.label}</button>
            );
          })}
        </div>

        {/* Programador: cuándo arranca lo que encolás ahora */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="muted flex items-center gap-1 text-xs"><Clock size={13} strokeWidth={1.5} />Empezar</span>
          {DELAYS.map((d) => (
            <button key={d.min} onClick={() => { sfx.tick(); setDelay(d.min); }} aria-pressed={delay === d.min}
              className={`btn sq-pill px-3 py-1 text-xs mono ${delay === d.min ? "bg-[var(--fill-2)]" : "btn-glass muted"}`}
              title={d.min ? `espera ${d.label} antes de arrancar (la cola queda guardada)` : "arranca en cuanto haya hueco"}>{d.label}</button>
          ))}
          {cfg?.quietEnabled && (
            <span className="mono sq-pill flex items-center gap-1 px-2.5 py-1 text-[11px]" style={{ background: "var(--red-wash)", color: "var(--accent-ink)", boxShadow: "inset 0 0 0 1px var(--red-line)" }}
              title="En Ajustes activaste una ventana silenciosa: la cola solo arranca dentro de ese horario">
              <Moon size={12} strokeWidth={1.75} />{cfg.quietFrom}–{cfg.quietTo}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button onClick={download} disabled={busy || !links.length} className="btn btn-primary h-12 px-6 sq-pill">{busy ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} strokeWidth={1.75} className="ico" />}Descargar</button>
          <button onClick={preview} disabled={!links.length} className="btn btn-glass h-12 px-5 sq-pill"><Eye size={18} strokeWidth={1.5} className="ico" />Vista previa</button>
          <button onClick={() => { sfx.pop(); fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: "{}" }); }} className="btn btn-glass h-12 px-5 sq-pill"><FolderOpen size={18} strokeWidth={1.5} className="ico" />Abrir carpeta</button>
          <span className="muted ml-auto text-xs">⌘/Ctrl + Enter</span>
        </div>
        <p className="muted mt-4 text-xs">
          <span className="font-semibold text-[var(--fg)]"><Odometer value={status.files} /></span> archivo(s) en tu carpeta actual · cero subidas a internet: todo se procesa en esta máquina
          {status.freeLabel && (
            <span className="mono block pt-1 opacity-70">
              espacio libre: {status.freeLabel}
              {status.freeBytes != null && status.freeBytes < 5 * 1024 ** 3 && <span className="ml-2 text-[var(--danger-ink)]">· ojo, se está llenando</span>}
            </span>
          )}
          {status.outputDir && <span className="mono block truncate pt-1 opacity-70">{status.outputDir}</span>}
        </p>
      </Panel>

      {/* Vista previa */}
      {previews && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {previews.map((p, i) => (
            <Panel key={p.url} tilt className="rise overflow-hidden" >
              <div className="relative aspect-video bg-black/30" style={{ animationDelay: `${i * 60}ms` }}>
                {/* Placeholder debajo: si la portada no carga (onError) se ve él, no un icono roto */}
                <div className={`absolute inset-0 grid place-items-center ${p.title || p.error ? "" : "skeleton"}`}><Sparkles className="opacity-30" /></div>
                {p.thumbnail && <img src={p.thumbnail} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                {!!p.duration && <span className="mono absolute bottom-2 right-2 rounded-lg bg-black/70 px-2 py-0.5 text-[11px] text-white">{fmtDuration(p.duration)}</span>}
                {p.date && <span className="mono absolute bottom-2 left-2 rounded-lg bg-black/70 px-2 py-0.5 text-[11px] text-white">{p.date}</span>}
              </div>
              <div className="p-4">
                <div className="line-clamp-2 text-sm font-semibold">{p.title ?? (p.error ? p.url : `Inspeccionando… ${esperando > 1 ? `${esperando} s` : ""}`)}</div>
                <div className="muted mt-1 truncate text-xs">{[p.author, p.views != null ? fmtViews(p.views) : ""].filter(Boolean).join(" · ")}</div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="mono sq-pill flex items-center gap-1.5 bg-[var(--fill-2)] px-2 py-0.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color, boxShadow: `0 0 6px ${p.color}` }} />{p.platform}</span>
                  <span className="mono sq-pill px-2 py-0.5" style={{ background: "var(--fill-2)" }}>motor: {p.engine}</span>
                  {p.entries ? <span className="mono sq-pill bg-[var(--fill-2)] px-2 py-0.5">{p.entries} elementos</span> : null}
                  {p.size ? <span className="mono sq-pill bg-[var(--fill-2)] px-2 py-0.5" title="tamaño aproximado">{fmtBytes(p.size)}</span> : null}
                  {p.heights?.slice(0, 5).map((h) => <span key={h} className="mono sq-pill bg-[var(--fill-2)] px-2 py-0.5">{h}p</span>)}
                </div>
                {(p.error || p.note) && <p className={`mt-2 text-xs ${p.error ? "text-[var(--danger-ink)]" : "muted"}`}>{p.error ?? p.note}</p>}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Queue jobs={jobs} jobAction={jobAction} />
      <Suscripciones formats={{ audio: AUDIO_FORMATS, video: VIDEO_FORMATS, photo: PHOTO_FORMATS }} />
    </div>
  );
}

// Chips de formato con FLIP: miden su posición antes/después y animan la diferencia con spring
function FormatChips({ formats, value, onChange }: { formats: readonly string[]; value: string; onChange: (f: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const els = ref.current?.querySelectorAll<HTMLElement>("[data-f]") ?? [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      const p = prev.current.get(el.dataset.f!);
      if (!reduced) {
        if (p) el.animate([{ transform: `translate(${p.left - r.left}px,${p.top - r.top}px)` }, { transform: "none" }], { duration: 600, easing: "cubic-bezier(.2,1.4,.4,1)" });
        else el.animate([{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "cubic-bezier(.2,1.4,.4,1)" });
      }
      prev.current.set(el.dataset.f!, r);
    });
  }, [formats]);
  return (
    <div ref={ref} className="mt-5 flex flex-wrap items-center gap-2">
      <span className="muted text-xs">Formato</span>
      {formats.map((f) => (
        <button key={f} data-f={f} onClick={() => onChange(f)} aria-pressed={value === f} className={`btn sq-pill px-3.5 py-1.5 text-xs uppercase mono ${value === f ? "btn-primary" : "btn-glass"}`}>{f === "vorbis" ? "ogg" : f}</button>
      ))}
    </div>
  );
}

// Cola viva con drag-reorder (pointer events, inercia y snap)
function Queue({ jobs, jobAction }: { jobs: ReturnType<typeof useApp>["jobs"]; jobAction: ReturnType<typeof useApp>["jobAction"] }) {
  // `h` = alto REAL de la fila medida en el pointerdown. Antes había un
  // `const ROW = 76` fijo: en móvil el título ocupa dos líneas, la fila mide
  // ~96 px y arrastrar una posición saltaba dos. Ahora el cálculo usa la
  // geometría real (+8 px del `space-y-2`).
  const [drag, setDrag] = useState<{ id: string; y: number; start: number; idx: number; h: number } | null>(null);
  if (!jobs.length) return null;
  const onDown = (e: React.PointerEvent, id: string, idx: number) => {
    const li = (e.currentTarget as HTMLElement).closest("li") as HTMLElement | null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, y: 0, start: e.clientY, idx, h: li?.offsetHeight ?? 76 });
    sfx.tick();
  };
  const onMove = (e: React.PointerEvent) => drag && setDrag({ ...drag, y: e.clientY - drag.start });
  const onUp = () => {
    if (!drag) return;
    const paso = drag.h + 8;
    const to = Math.max(0, Math.min(jobs.length - 1, drag.idx + Math.round(drag.y / paso)));
    if (to !== drag.idx) void jobAction(drag.id, "move", to);
    setDrag(null);
  };
  const label: Record<string, string> = { queued: "En cola", probing: "Inspeccionando", running: "Bajando", post: "Post-proceso", paused: "Pausado", done: "Listo", error: "Error", canceled: "Cancelado", skipped: "Omitido" };
  return (
    <Panel className="p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="tick text-lg font-semibold tracking-tight">Cola</h2>
        <button onClick={() => { sfx.pop(); fetch("/api/jobs", { method: "DELETE", headers: { "x-linyue": "1" } }); }} className="btn btn-glass sq-pill px-3 py-1.5 text-xs"><Trash2 size={14} strokeWidth={1.5} />Limpiar terminados</button>
      </div>
      <ul className="space-y-2" onPointerMove={onMove} onPointerUp={onUp}>
        {jobs.map((j, i) => {
          const dragging = drag?.id === j.id;
          return (
            <li key={j.id} className="scrim flex items-center gap-3 border border-[var(--line)] p-3 sq-sm"
              style={{ transform: dragging ? `translateY(${drag.y}px) scale(1.02)` : "none", transition: dragging ? "none" : "transform 500ms var(--spring)", zIndex: dragging ? 10 : 0, position: "relative", boxShadow: dragging ? "0 20px 40px -10px rgba(0,0,0,.5)" : undefined }}>
              <button aria-label="Reordenar" onPointerDown={(e) => onDown(e, j.id, i)} className="muted cursor-grab touch-none"><GripVertical size={16} /></button>
              <Ring value={j.state === "done" ? 100 : j.percent} speed={j.state === "running" ? j.speed : 0} color={j.state === "error" ? "var(--danger-ink)" : j.state === "done" ? "var(--ok-ink)" : "var(--red)"} size={40}>{j.state === "done" ? "✓" : `${Math.round(j.percent)}`}</Ring>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{j.title}</div>
                <div className="mono muted truncate text-[11px]">{j.label} · {j.engine} · {j.format.toUpperCase()} · {label[j.state]}{j.state === "running" && ` · ${fmtBytes(j.speed)}/s · ETA ${j.eta || "—"}`}{j.state === "queued" && j.startAt && ` · empieza a las ${new Date(j.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}{j.error && ` · ${j.error}`}</div>
              </div>
              {["running", "probing", "queued"].includes(j.state) && <button aria-label="Pausar" onClick={() => jobAction(j.id, "pause")} className="btn btn-glass h-9 w-9 sq-pill"><Pause size={15} /></button>}
              {j.state === "paused" && <button aria-label="Reanudar" onClick={() => jobAction(j.id, "resume")} className="btn btn-glass h-9 w-9 sq-pill"><Play size={15} /></button>}
              {["error", "canceled", "skipped"].includes(j.state) && <button aria-label="Reintentar" onClick={() => jobAction(j.id, "retry")} className="btn btn-glass h-9 w-9 sq-pill"><RotateCcw size={15} /></button>}
              <button aria-label="Quitar" onClick={() => jobAction(j.id, ["running", "probing", "queued", "paused"].includes(j.state) ? "cancel" : "remove")} className="btn btn-glass h-9 w-9 sq-pill"><X size={15} /></button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ── Suscripciones ─────────────────────────────────────────────────────────────
// Vive aquí abajo y no en Ajustes a propósito: es una acción de todos los días,
// y un canal guardado tiene que vérselo de un vistazo al abrir la app.
const INTERVALOS = [3, 6, 12, 24];

function Suscripciones({ formats }: { formats: Record<string, readonly string[]> }) {
  const { toast } = useApp();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [url, setUrl] = useState("");
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    fetch("/api/subs").then((r) => r.json()).then((d) => setSubs(d.subs ?? [])).catch(() => {});
  }, []);
  // El campo para pegar una URL se ve siempre que la lista esté vacía o que el
  // usuario lo haya abierto: sin efectos que reaccionen a la lista.
  const mostrarAlta = abierto || subs.length === 0;

  const enviar = async (cuerpo: Record<string, unknown>, metodo = "POST") => {
    // DELETE lleva el id en la QUERY, no en el cuerpo: la ruta lo lee de la URL.
    // Sin esto, quitar una suscripción devolvía 404 y no hacía nada.
    const url = metodo === "DELETE" && cuerpo.id ? `/api/subs?id=${encodeURIComponent(String(cuerpo.id))}` : "/api/subs";
    const r = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json", "x-linyue": "1" },
      body: metodo === "DELETE" ? undefined : JSON.stringify(cuerpo),
    });
    const d = await r.json();
    if (!r.ok) { toast({ kind: "err", title: "No se pudo", body: d.error }); return null; }
    if (d.subs) setSubs(d.subs);
    return d;
  };

  const agregar = async () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) { toast({ kind: "err", title: "Pega la URL del canal o de la playlist", body: "Tiene que empezar por https://" }); return; }
    setCargando(true);
    const d = await enviar({ action: "add", url: u });
    setCargando(false);
    if (d) { setUrl(""); sfx.success(); toast({ kind: "ok", title: "Canal guardado", body: "Se revisará cada pocas horas" }); }
  };

  const revisar = async (id?: string) => {
    setCargando(true);
    const d = await enviar({ action: id ? "check" : "checkAll", id });
    setCargando(false);
    const r = d?.resultado?.[0];
    if (r) toast({ kind: r.ok ? "ok" : "err", title: r.ok ? "Revisado" : "Falló la revisión", body: r.mensaje });
  };

  return (
    <Panel className="p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="tick flex items-center gap-2 text-lg font-semibold tracking-tight"><Radio size={16} strokeWidth={1.5} />Suscripciones</h2>
        <div className="flex items-center gap-2">
          {subs.length > 0 && (
            <button onClick={() => void revisar()} disabled={cargando} className="btn btn-glass sq-pill px-3 py-1.5 text-xs">
              {cargando ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} strokeWidth={1.5} />}Revisar ahora
            </button>
          )}
          <button onClick={() => setAbierto((v) => !v)} className="btn btn-glass sq-pill px-3 py-1.5 text-xs" aria-expanded={mostrarAlta}>
            {mostrarAlta ? "Ocultar" : "Añadir"}
          </button>
        </div>
      </div>

      {mostrarAlta && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void agregar(); }}
            placeholder="https://www.youtube.com/@canal  ·  playlist  ·  perfil"
            aria-label="URL del canal a seguir"
            className="mono flex-1 px-3 py-2 text-xs outline-none sq-pill"
            style={{ background: "var(--fill)", border: "1px solid var(--line)", color: "var(--fg)" }}
          />
          <button onClick={() => void agregar()} disabled={cargando || !url.trim()} className="btn btn-primary sq-pill px-4 py-2 text-xs">
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={1.8} />}Guardar canal
          </button>
        </div>
      )}

      {subs.length === 0 ? (
        <p className="muted text-xs">
          Guarda un canal y Linyue mira si hay algo nuevo cada pocas horas. Lo que encuentra entra en la cola como
          cualquier otra descarga: con sus reintentos, su ventana silenciosa y su archivo de descargados.
        </p>
      ) : (
        <ul className="space-y-2">
          {subs.map((s) => (
            <li key={s.id} className="scrim flex flex-wrap items-center gap-3 border border-[var(--line)] p-3 sq-sm">
              <Radio size={15} strokeWidth={1.5} className="shrink-0" style={{ color: "var(--red)" }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.label}</div>
                <div className="mono muted truncate text-[11px]">{describirRevision(s)} · {s.mode}/{s.format} · {s.lastResult ?? "—"}</div>
              </div>
              <select
                value={s.everyHours} aria-label={`Cada cuántas horas revisar ${s.label}`}
                onChange={(e) => void enviar({ action: "update", id: s.id, everyHours: Number(e.target.value) })}
                className="mono px-2 py-1 text-[11px] outline-none sq-pill"
                style={{ background: "var(--fill)", border: "1px solid var(--line)", color: "var(--fg)" }}
              >
                {INTERVALOS.map((h) => <option key={h} value={h}>cada {h} h</option>)}
              </select>
              <button aria-label="Revisar ahora" onClick={() => void revisar(s.id)} disabled={cargando} className="btn btn-glass h-8 w-8 sq-pill"><RotateCcw size={14} strokeWidth={1.5} /></button>
              <button aria-label="Quitar suscripción" onClick={() => void enviar({ id: s.id }, "DELETE")} className="btn btn-glass h-8 w-8 sq-pill"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {subs.length > 0 && (
        <p className="muted mt-3 text-[11px]">
          Cada revisión encola como mucho 5 elementos nuevos, así un canal con 3000 vídeos no te llena el disco de golpe.
        </p>
      )}
    </Panel>
  );
}
