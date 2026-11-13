"use client";
// "/ajustes": carpeta, formatos, concurrencia, turbo aria2c, rutas de motores + panel Motor vivo, tema, sonido, atajos, reset, Acerca de.
import { useEffect, useState } from "react";
import { RefreshCw, Save, RotateCcw, Cpu, Keyboard, DownloadCloud } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo, Panel, Segmented, Toggle } from "@/components/ui";
import { sfx } from "@/lib/client/sound";
import type { ConfigView } from "@/lib/client/types";
import { AUDIO_FORMATS, VIDEO_FORMATS, PHOTO_FORMATS } from "@/lib/shared/platforms";
import { VIDEO_CODECS } from "@/lib/shared/codecs";

import type { ReactNode } from "react";
/**
 * Fila de ajuste.
 *
 * El bug visual era este: los controles vivían en un `flex` sin ancho definido y
 * cada uno traía el suyo (`w-64`, `w-24`, `auto`…), así que el borde derecho de
 * la tarjeta quedaba en zigzag: la carpeta acababa en x=340, el select de audio
 * en x=310, el de vídeo en x=280… La columna de controles ahora mide siempre lo
 * mismo (300 px en escritorio) y los hijos se estiran a `w-full`, de modo que
 * TODOS los campos terminan en la misma vertical.
 */
function Row({ label, hint, children, stack }: { label: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="muted text-xs">{hint}</div>}
      </div>
      <div className={`flex w-full items-center justify-end gap-2 sm:w-[300px] ${stack ? "" : "shrink-0"}`}>{children}</div>
    </div>
  );
}

const NAMING: Record<ConfigView["naming"], string> = {
  ordenado: "una carpeta por canal, título + [id] (recomendado)",
  fecha: "carpeta por canal y fecha delante: ordena cronológicamente",
  compacto: "todo suelto en la carpeta de salida",
  plano: "solo el título (dos vídeos iguales chocan)",
};

const FIDELIDAD: Record<ConfigView["fidelity"], string> = {
  estricto: "entrega el códec original (AAC → .m4a) y avisa",
  avisar: "convierte, pero el archivo se marca como transcode",
  libre: "convierte sin preguntar (puede inflar el peso)",
};

export default function Ajustes() {
  const { engines, rescan, toast, theme, toggleTheme, muted, toggleMute } = useApp();
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [scanning, setScanning] = useState(false);
  const [updating, setUpdating] = useState(false);
  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg); }, []);
  if (!cfg) return <div className="glass skeleton h-96 sq" />;
  const set = <K extends keyof ConfigView>(k: K, v: ConfigView[K]) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    sfx.pop();
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify(cfg) });
    const d = await r.json();
    if (!r.ok) return toast({ kind: "err", title: "Ajustes inválidos", body: d.error });
    setCfg(d); toast({ kind: "ok", title: "Ajustes guardados" }); void rescan();
  };
  const reset = async () => { if (!confirm("¿Restablecer todos los ajustes?")) return; setCfg(await (await fetch("/api/config", { method: "POST", headers: { "x-linyue": "1" } })).json()); toast({ kind: "info", title: "Ajustes restablecidos" }); };
  const doScan = async () => { sfx.pop(); setScanning(true); await rescan(); setScanning(false); };
  // Actualizar motores: yt-dlp se rompe cada pocas semanas cuando un sitio
  // cambia; este botón corre sus comandos oficiales de auto-actualización.
  const doUpdate = async () => {
    sfx.pop(); setUpdating(true);
    try {
      const r = await fetch("/api/engines/update", { method: "POST", headers: { "x-linyue": "1" } });
      const d = await r.json();
      const res: { id: string; ok: boolean; msg: string }[] = d.results ?? [];
      const bien = res.filter((x) => x.ok).length;
      toast({ kind: bien ? "ok" : "err", title: bien ? `${bien} motor(es) actualizados` : "No se pudo actualizar",
        body: res.map((x) => `${x.id}: ${x.msg.slice(0, 60)}`).join(" · ") });
      await rescan();
    } catch (e) { toast({ kind: "err", title: "Error actualizando", body: e instanceof Error ? e.message : "" }); }
    setUpdating(false);
  };
  const ok = engines.filter((e) => e.health === "ok").length;

  const input = "mono scrim w-full min-w-0 border border-[var(--line)] px-3 py-2 text-xs outline-none sq-pill focus:border-[var(--red-line)]";

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div><p className="label" style={{ color: "var(--accent-ink)" }}>Configuración local</p><h1 className="display mt-2 text-[2.4rem]">Ajustes</h1><p className="muted mt-2 text-sm">Se guardan en <span className="mono">config.json</span> · nada sale de esta máquina.</p></div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn btn-glass h-10 px-4 text-sm sq-pill"><RotateCcw size={15} />Restablecer</button>
          <button onClick={save} className="btn btn-primary h-10 px-5 text-sm sq-pill"><Save size={15} />Guardar</button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
        <Panel className="p-5">
          <h2 className="mb-1 tick font-semibold tracking-tight">Descargas</h2>
          <Row label="Carpeta de salida"><input className={input} value={cfg.outputDir} onChange={(e) => set("outputDir", e.target.value)} aria-label="Carpeta de salida" /></Row>
          <Row label="Audio por defecto"><select className={`${input} w-[148px]`} value={cfg.audioFormat} onChange={(e) => set("audioFormat", e.target.value)}>{AUDIO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Row>
          <Row label="Video por defecto"><div className="grid w-full grid-cols-2 gap-2">
              <select className={`${input} w-full`} value={cfg.videoFormat} onChange={(e) => set("videoFormat", e.target.value)} aria-label="Formato de vídeo">{VIDEO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
              <select className={`${input} w-full`} value={cfg.videoQuality} onChange={(e) => set("videoQuality", e.target.value)} aria-label="Calidad de vídeo">{["best", "4320", "2160", "1440", "1080", "720", "480"].map((f) => <option key={f}>{f === "best" ? "máx" : f === "4320" ? "8K" : f === "2160" ? "4K" : `${f}p`}</option>)}</select>
            </div></Row>
          <Row label="Fotos" hint="Conversión con Magick"><select className={`${input} w-[148px]`} value={cfg.photoFormat} onChange={(e) => set("photoFormat", e.target.value)}>{PHOTO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Row>
          {/* «Sin límite» = 0. No son procesos infinitos: se lanzan tantos como
              haga falta hasta el techo de seguridad (`maxConcurrency`), porque
              abrir 200 procesos en Windows agota los handles (EMFILE) y los
              CDN responden 429 a todo el que llega con esa cara. */}
          <Row label="Descargas en paralelo" hint={cfg.concurrency === 0 ? `sin límite (techo ${cfg.maxConcurrency})` : `${cfg.concurrency} a la vez`}>
            <input type="range" min={0} max={32} value={cfg.concurrency} onChange={(e) => set("concurrency", +e.target.value)} className="min-w-0 flex-1 accent-[var(--red)]" aria-label="Descargas en paralelo" />
            <span className="mono w-9 shrink-0 text-right text-sm tabular-nums">{cfg.concurrency === 0 ? "∞" : cfg.concurrency}</span>
          </Row>
          <Row label="Techo de seguridad" hint="Procesos máx. cuando el paralelismo es ∞"><input type="number" min={1} max={64} className={`${input} w-24 text-right`} value={cfg.maxConcurrency} onChange={(e) => set("maxConcurrency", Math.max(1, Math.min(64, +e.target.value || 1)))} /></Row>
          <Row label="Vistas previas a la vez" hint="Sondas yt-dlp simultáneas"><input type="number" min={1} max={12} className={`${input} w-24 text-right`} value={cfg.probeConcurrency} onChange={(e) => set("probeConcurrency", Math.max(1, Math.min(12, +e.target.value || 1)))} /></Row>
          <Row label="Nombres de archivo" hint={NAMING[cfg.naming]}>
            <select className={`${input} w-full`} value={cfg.naming} onChange={(e) => set("naming", e.target.value as typeof cfg.naming)} aria-label="Nombres de archivo">
              <option value="ordenado">Canal / título [id]</option>
              <option value="fecha">Canal / fecha — título</option>
              <option value="compacto">Título [id] (sin carpetas)</option>
              <option value="plano">Solo título</option>
            </select>
          </Row>
          <Row label="Rango de la lista" hint="Vacío = todo · 1-20 · -10 · 1,3,7-9"><input className={input} placeholder="1-20" value={cfg.playlistRange} onChange={(e) => set("playlistRange", e.target.value)} aria-label="Rango de la lista" /></Row>
          <Row label="Límite de perfil" hint="Máx. elementos por canal/cuenta"><input type="number" min={1} max={5000} className={`${input} w-24 text-right`} value={cfg.profileLimit} onChange={(e) => set("profileLimit", +e.target.value || 1)} /></Row>
          <Row label="Modo turbo" hint="aria2c · 16 conexiones"><Toggle label="Modo turbo" checked={cfg.turbo} onChange={(v) => set("turbo", v)} /></Row>
          <Row label="No repetir lo ya descargado" hint="archive.txt + historial"><Toggle label="No repetir" checked={cfg.noRepeat} onChange={(v) => set("noRepeat", v)} /></Row>
          <Row label="lux para sitios CN" hint="Bilibili, Douyin, iQiyi…"><Toggle label="lux" checked={cfg.altEngineCN} onChange={(v) => set("altEngineCN", v)} /></Row>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 tick font-semibold tracking-tight">Programador</h2>
          <p className="muted mb-2 text-xs">
            La cola no arranca nada nuevo fuera de la ventana; lo que ya está bajando NO se corta (matar una descarga al 90 % sería peor).
            Los trabajos queda guardados: si cierras la app, siguen esperando su hora.
          </p>
          <Row label="Solo de noche" hint={cfg.quietEnabled ? `Activo: ${cfg.quietFrom} → ${cfg.quietTo}${cfg.quietFrom > cfg.quietTo ? " (cruza medianoche)" : ""}` : "Apagado: descarga a cualquier hora"}>
            <Toggle label="Solo de noche" checked={cfg.quietEnabled} onChange={(v) => set("quietEnabled", v)} />
          </Row>
          <Row label="Abrir" hint="Hora local de este equipo">
            <input type="time" className={`${input} w-[150px]`} value={cfg.quietFrom} onChange={(e) => set("quietFrom", e.target.value)} aria-label="Hora de apertura" disabled={!cfg.quietEnabled} />
          </Row>
          <Row label="Cerrar" hint="A esta hora deja de arrancar trabajos nuevos">
            <input type="time" className={`${input} w-[150px]`} value={cfg.quietTo} onChange={(e) => set("quietTo", e.target.value)} aria-label="Hora de cierre" disabled={!cfg.quietEnabled} />
          </Row>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 tick font-semibold tracking-tight">Fidelidad de audio</h2>
          <p className="muted mb-2 text-xs">Un FLAC solo es FLAC si el origen lo era. YouTube sirve AAC/Opus: reconvertirlo «a FLAC» da un archivo 5 veces más pesado con el mismo sonido.</p>
          <Row label="Si pido un formato mejor que el origen" hint={FIDELIDAD[cfg.fidelity]}>
            <select className={`${input} w-full`} value={cfg.fidelity} onChange={(e) => set("fidelity", e.target.value as typeof cfg.fidelity)} aria-label="Fidelidad">
              <option value="estricto">Estricta · entrega el original</option>
              <option value="avisar">Avisar · convierte y lo marca</option>
              <option value="libre">Libre · convierte siempre</option>
            </select>
          </Row>
          <Row label="Calidad al convertir" hint="Solo afecta a mp3/aac"><select className={`${input} w-[148px]`} value={cfg.audioQuality} onChange={(e) => set("audioQuality", e.target.value)}>{["best", "320K", "256K", "192K", "128K"].map((q) => <option key={q}>{q === "best" ? "máx (320K)" : q}</option>)}</select></Row>
        </Panel>

        <Panel className="p-5">
          <h2 className="mb-1 tick font-semibold tracking-tight">Vídeo, códecs y pistas</h2>
          <p className="muted mb-2 text-xs">El contenedor (MP4/MKV) es la caja; el códec es lo que va dentro. Un TV viejo quiere H.264 aunque el sitio sirva AV1.</p>
          <Row label="Códec de vídeo" hint={VIDEO_CODECS.find((c) => c.id === cfg.videoCodec)?.note}>
            <select className={`${input} w-full`} value={cfg.videoCodec} onChange={(e) => set("videoCodec", e.target.value as typeof cfg.videoCodec)} aria-label="Códec de vídeo">
              {VIDEO_CODECS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Row>
          <Row label="Recodificar si falta el códec" hint="Segunda pasada con ffmpeg · lento pero cumple"><Toggle label="Recodificar vídeo" checked={cfg.reencodeVideo} onChange={(v) => set("reencodeVideo", v)} /></Row>
          <Row label="Subtítulos" hint={cfg.subtitles === "off" ? "no se descargan" : cfg.subtitles === "embed" ? "dentro del archivo · .srt convertido" : "archivo .srt aparte"}>
            <select className={`${input} w-[148px]`} value={cfg.subtitles} onChange={(e) => set("subtitles", e.target.value as typeof cfg.subtitles)}>
              <option value="off">no</option>
              <option value="sidecar">aparte (.srt)</option>
              <option value="embed">incrustados</option>
            </select>
          </Row>
          <Row label="Idiomas" hint="Códigos separados por coma · &quot;all&quot; = todos"><input className={input} value={cfg.subLangs} onChange={(e) => set("subLangs", e.target.value)} aria-label="Idiomas de subtítulos" /></Row>
          <Row label="Subtítulos automáticos" hint="Los que genera el sitio (YouTube)"><Toggle label="Subs automáticos" checked={cfg.autoSubs} onChange={(v) => set("autoSubs", v)} /></Row>
          <Row label="Capítulos" hint="Incrustar marcas de tiempo"><Toggle label="Capítulos" checked={cfg.chapters} onChange={(v) => set("chapters", v)} /></Row>
          <Row label="Miniatura como carátula" hint="Portada dentro del archivo"><Toggle label="Carátula" checked={cfg.embedThumbnail} onChange={(v) => set("embedThumbnail", v)} /></Row>
          <Row label="Conservar el original" hint="Al convertir audio o vídeo"><Toggle label="Conservar original" checked={cfg.keepOriginal} onChange={(v) => set("keepOriginal", v)} /></Row>
        </Panel>

        </div>

        <div className="space-y-6">
          <Panel className="p-5">
            <h2 className="mb-1 tick font-semibold tracking-tight">Apariencia y sonido</h2>
            <Row label="Tema" hint="Carbón y carmesí · el claro es hueso, no pastel"><Segmented options={[{ value: "dark", label: "Carbón" }, { value: "light", label: "Hueso" }]} value={theme} onChange={(v) => v !== theme && toggleTheme()} /></Row>
          <Row label="Sonidos de interfaz" hint="Web Audio sintetizado"><Toggle label="Sonido" checked={!muted} onChange={toggleMute} /></Row>
          </Panel>

          <Panel className="p-5">
          <h2 className="mb-1 tick font-semibold tracking-tight">Red, cookies y límites</h2>
          <Row label="Cookies del navegador" hint="yt-dlp las lee del perfil, nunca se copian aquí"><select className={`${input} w-[148px]`} value={cfg.cookiesFromBrowser} onChange={(e) => set("cookiesFromBrowser", e.target.value)}>
            <option value="">desactivado</option>
            {["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "chromium", "safari"].map((b) => <option key={b}>{b}</option>)}
          </select></Row>
          <Row label="Impersonar navegador" hint="Útil contra muros anti-bot (403)"><select className={`${input} w-[148px]`} value={cfg.impersonate} onChange={(e) => set("impersonate", e.target.value)}>
            <option value="">no</option>
            {["chrome", "safari", "firefox", "edge"].map((b) => <option key={b}>{b}</option>)}
          </select></Row>
          <Row label="Límite de velocidad" hint="Por descarga · vacío = sin tope"><input className={input} placeholder="5M" value={cfg.limitRate} onChange={(e) => set("limitRate", e.target.value)} aria-label="Límite de velocidad" /></Row>
          <Row label="Pausa entre peticiones" hint="Segundos · evita el 429"><input type="number" step="0.25" min={0} max={30} className={`${input} w-24 text-right`} value={cfg.sleepRequests} onChange={(e) => set("sleepRequests", Math.max(0, Math.min(10, +e.target.value || 0)))} /></Row>
          <Row label="Proxy" hint="http://127.0.0.1:7890 · socks5://… · vacío = directo"><input className={input} placeholder="http://127.0.0.1:7890" value={cfg.proxy} onChange={(e) => set("proxy", e.target.value)} aria-label="Proxy" /></Row>
          <Row label="Carpeta en Baidu Pan" hint="Destino del 转存 · solo 百度网盘"><input className={input} value={cfg.baiduDir} onChange={(e) => set("baiduDir", e.target.value)} aria-label="Carpeta en Baidu Pan" /></Row>
          <Row label="Reintentos por descarga" hint="Antes de darse por vencido"><input type="number" min={0} max={10} className={`${input} w-24 text-right`} value={cfg.retries} onChange={(e) => set("retries", Math.max(0, Math.min(10, +e.target.value || 0)))} /></Row>
        </Panel>
          <Panel className="p-5">
            <h2 className="mb-3 tick flex items-center gap-2 font-semibold"><Keyboard size={16} strokeWidth={1.5} />Atajos</h2>
            <ul className="grid grid-cols-2 gap-2 text-xs">
              {[["Ctrl/⌘ + Enter", "Descargar"], ["Alt + 1…4", "Cambiar pestaña"], ["Click derecho", "Menú de ficha"], ["Arrastrar ⋮⋮", "Reordenar cola"]].map(([k, v]) => <li key={k} className="scrim flex justify-between gap-2 px-3 py-2 sq-sm"><span className="mono">{k}</span><span className="muted">{v}</span></li>)}
            </ul>
          </Panel>
        </div>
      </div>

      {/* Panel Motor vivo */}
      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="tick flex items-center gap-2 font-semibold"><Cpu size={17} strokeWidth={1.5} />Motor vivo <span className="mono muted text-xs">{ok}/{engines.length} listos</span></h2>
          <div className="flex items-center gap-2">
            <input className={`${input} w-full sm:w-72`} value={cfg.vendorDir} onChange={(e) => set("vendorDir", e.target.value)} aria-label="Carpeta vendor" title="Carpeta /vendor" />
            <button onClick={doUpdate} disabled={updating} className="btn btn-glass h-9 px-4 text-xs sq-pill" title="yt-dlp -U · gallery-dl --update · BaiduPCS-Go update">
              <DownloadCloud size={14} className={updating ? "animate-bounce" : "ico"} />{updating ? "Actualizando…" : "Actualizar"}
            </button>
            <button onClick={doScan} className="btn btn-glass h-9 px-4 text-xs sq-pill"><RefreshCw size={14} className={scanning ? "animate-spin" : "ico"} />Re-escanear</button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {engines.map((e, i) => (
            <div key={e.id} className="scrim rise flex items-center gap-3 border border-[var(--line)] p-3 sq-sm" style={{ animationDelay: `${i * 35}ms` }}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.health === "ok" ? "" : ""}`} style={{ background: e.health === "ok" ? "var(--ok-ink)" : e.health === "warn" ? "var(--warn-ink)" : "var(--danger-ink)", boxShadow: `0 0 9px ${e.health === "ok" ? "var(--ok-ink)" : e.health === "warn" ? "var(--warn-ink)" : "var(--danger-ink)"}` }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2"><span className="mono text-sm">{e.exe}</span>{e.optional && <span className="muted text-[11px]">opcional</span>}</div>
                <div className="muted truncate text-[11px]">{e.role}</div>
                <input className="mono mt-1 w-full bg-transparent text-[11px] opacity-60 outline-none focus:opacity-100" placeholder={e.path ?? "ruta personalizada…"} value={cfg.enginePaths[e.id] ?? ""} onChange={(ev) => set("enginePaths", { ...cfg.enginePaths, [e.id]: ev.target.value })} aria-label={`Ruta de ${e.exe}`} />
              </div>
              <span className="mono shrink-0 text-[11px]">{e.version ?? e.note}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Acerca de: sello discreto */}
      <Panel className="flex items-center gap-4 p-5">
        <Logo size={44} />
        <div className="flex-1"><div className="font-semibold">Linyue Studio</div><div className="muted text-xs">Descargador universal local · sin nube, sin telemetría (Sentry y Plausible OFF)</div></div>
        <div className="text-right">
          <div className="text-xs muted">hecho por</div>
          <div className="text-sm font-medium">Lin Yue <span className="inline-block rotate-[-6deg] border px-1 text-[var(--danger-ink)]" style={{ fontFamily: "serif" }}>林玥</span></div>
        </div>
      </Panel>
    </div>
  );
}
