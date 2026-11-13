"use client";
// "/ajustes": carpeta, formatos, concurrencia, turbo aria2c, rutas de motores + panel Motor vivo, tema, sonido, atajos, reset, Acerca de.
import { useEffect, useState } from "react";
import { RefreshCw, Save, RotateCcw, Cpu, Keyboard } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo, Panel, Segmented, Toggle } from "@/components/ui";
import { sfx } from "@/lib/client/sound";
import type { ConfigView } from "@/lib/client/types";
import { AUDIO_FORMATS, VIDEO_FORMATS, PHOTO_FORMATS } from "@/lib/shared/platforms";

import type { ReactNode } from "react";
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] py-3.5 last:border-0">
      <div><div className="text-sm font-medium">{label}</div>{hint && <div className="muted text-xs">{hint}</div>}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export default function Ajustes() {
  const { engines, rescan, toast, theme, toggleTheme, muted, toggleMute } = useApp();
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => { fetch("/api/config").then((r) => r.json()).then(setCfg); }, []);
  if (!cfg) return <div className="glass skeleton h-96 sq" />;
  const set = <K extends keyof ConfigView>(k: K, v: ConfigView[K]) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    sfx.pop();
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const d = await r.json();
    if (!r.ok) return toast({ kind: "err", title: "Ajustes inválidos", body: d.error });
    setCfg(d); toast({ kind: "ok", title: "Ajustes guardados" }); void rescan();
  };
  const reset = async () => { if (!confirm("¿Restablecer todos los ajustes?")) return; setCfg(await (await fetch("/api/config", { method: "POST" })).json()); toast({ kind: "info", title: "Ajustes restablecidos" }); };
  const doScan = async () => { sfx.pop(); setScanning(true); await rescan(); setScanning(false); };
  const ok = engines.filter((e) => e.health === "ok").length;

  const input = "mono scrim border border-[var(--line)] px-3 py-2 text-xs outline-none sq-pill";

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-4xl font-bold tracking-[-0.035em]">Ajustes</h1><p className="muted mt-1 text-sm">Se guardan en <span className="mono">config.json</span> local.</p></div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn btn-glass h-10 px-4 text-sm sq-pill"><RotateCcw size={15} />Restablecer</button>
          <button onClick={save} className="btn btn-primary h-10 px-5 text-sm sq-pill"><Save size={15} />Guardar</button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-1 font-semibold">Descargas</h2>
          <Row label="Carpeta de salida"><input className={`${input} w-64`} value={cfg.outputDir} onChange={(e) => set("outputDir", e.target.value)} aria-label="Carpeta de salida" /></Row>
          <Row label="Audio por defecto"><select className={input} value={cfg.audioFormat} onChange={(e) => set("audioFormat", e.target.value)}>{AUDIO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Row>
          <Row label="Video por defecto"><select className={input} value={cfg.videoFormat} onChange={(e) => set("videoFormat", e.target.value)}>{VIDEO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className={input} value={cfg.videoQuality} onChange={(e) => set("videoQuality", e.target.value)}>{["best", "4320", "2160", "1440", "1080", "720", "480"].map((f) => <option key={f}>{f}</option>)}</select></Row>
          <Row label="Fotos" hint="Conversión con Magick"><select className={input} value={cfg.photoFormat} onChange={(e) => set("photoFormat", e.target.value)}>{PHOTO_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Row>
          <Row label="Descargas en paralelo"><input type="range" min={1} max={8} value={cfg.concurrency} onChange={(e) => set("concurrency", +e.target.value)} className="accent-fuchsia-400" aria-label="Concurrencia" /><span className="mono w-4 text-sm">{cfg.concurrency}</span></Row>
          <Row label="Límite de perfil" hint="Máx. elementos por canal/cuenta"><input type="number" min={1} max={5000} className={`${input} w-24`} value={cfg.profileLimit} onChange={(e) => set("profileLimit", +e.target.value || 1)} /></Row>
          <Row label="Modo turbo" hint="aria2c · 16 conexiones"><Toggle label="Modo turbo" checked={cfg.turbo} onChange={(v) => set("turbo", v)} /></Row>
          <Row label="No repetir lo ya descargado" hint="archive.txt + historial"><Toggle label="No repetir" checked={cfg.noRepeat} onChange={(v) => set("noRepeat", v)} /></Row>
          <Row label="lux para sitios CN" hint="Bilibili, Douyin, iQiyi…"><Toggle label="lux" checked={cfg.altEngineCN} onChange={(v) => set("altEngineCN", v)} /></Row>
        </Panel>

        <div className="space-y-6">
          <Panel className="p-5">
            <h2 className="mb-1 font-semibold">Apariencia y sonido</h2>
            <Row label="Tema"><Segmented options={[{ value: "dark", label: "Obsidiana" }, { value: "light", label: "Frosted" }]} value={theme} onChange={(v) => v !== theme && toggleTheme()} /></Row>
            <Row label="Sonidos de interfaz" hint="Web Audio sintetizado"><Toggle label="Sonido" checked={!muted} onChange={toggleMute} /></Row>
          </Panel>
          <Panel className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Keyboard size={16} strokeWidth={1.5} />Atajos</h2>
            <ul className="grid grid-cols-2 gap-2 text-xs">
              {[["Ctrl/⌘ + Enter", "Descargar"], ["Alt + 1…4", "Cambiar pestaña"], ["Click derecho", "Menú de ficha"], ["Arrastrar ⋮⋮", "Reordenar cola"]].map(([k, v]) => <li key={k} className="scrim flex justify-between gap-2 px-3 py-2 sq-sm"><span className="mono">{k}</span><span className="muted">{v}</span></li>)}
            </ul>
          </Panel>
        </div>
      </div>

      {/* Panel Motor vivo */}
      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold"><Cpu size={17} strokeWidth={1.5} />Motor vivo <span className="mono muted text-xs">{ok}/12 listos</span></h2>
          <div className="flex items-center gap-2">
            <input className={`${input} w-64`} value={cfg.vendorDir} onChange={(e) => set("vendorDir", e.target.value)} aria-label="Carpeta vendor" title="Carpeta /vendor" />
            <button onClick={doScan} className="btn btn-glass h-9 px-4 text-xs sq-pill"><RefreshCw size={14} className={scanning ? "animate-spin" : "ico"} />Re-escanear</button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {engines.map((e, i) => (
            <div key={e.id} className="scrim rise flex items-center gap-3 border border-[var(--line)] p-3 sq-sm" style={{ animationDelay: `${i * 35}ms` }}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.health === "ok" ? "bg-emerald-400" : e.health === "warn" ? "bg-amber-400" : "bg-rose-500"}`} style={{ boxShadow: `0 0 10px ${e.health === "ok" ? "#34d399" : e.health === "warn" ? "#fbbf24" : "#f43f5e"}` }} />
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
          <div className="text-sm font-medium">Lin Yue <span className="inline-block rotate-[-6deg] border border-rose-400/60 px-1 text-[var(--danger-ink)]" style={{ fontFamily: "serif" }}>林玥</span></div>
        </div>
      </Panel>
    </div>
  );
}
