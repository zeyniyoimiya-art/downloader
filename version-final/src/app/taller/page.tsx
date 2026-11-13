"use client";
// Taller: convertir, recortar y comprimir archivos que ya están en el disco.
import { useCallback, useEffect, useRef, useState } from "react";
import { FileVideo, Loader2, Music2, Play, Scissors, Trash2, Upload, X, FolderOpen } from "lucide-react";
import { Panel, Ring } from "@/components/ui";
import { useApp } from "@/components/AppProvider";
import { sfx } from "@/lib/client/sound";
import { fmtBytes } from "@/lib/shared/progress";
import type { TareaTaller } from "@/lib/server/taller";

const AUDIO = ["mp3", "m4a", "opus", "flac", "wav"] as const;
const VIDEO = ["mp4", "mkv", "webm"] as const;

type Destino = "audio" | "video" | "copia";

const DESTINOS: { id: Destino; label: string; hint: string }[] = [
  { id: "audio", label: "Solo audio", hint: "extrae la pista y la convierte" },
  { id: "video", label: "Vídeo", hint: "recodifica el vídeo al códec elegido" },
  { id: "copia", label: "Sin recodificar", hint: "solo cambia el contenedor o recorta" },
];

const ESTADO: Record<TareaTaller["state"], string> = {
  queued: "En cola",
  running: "Convirtiendo",
  done: "Listo",
  error: "Error",
  canceled: "Cancelado",
};

export default function Taller() {
  const { toast } = useApp();
  const [tareas, setTareas] = useState<TareaTaller[]>([]);
  const [destino, setDestino] = useState<Destino>("audio");
  const [elegido, setElegido] = useState<string>("mp3");
  const [crf, setCrf] = useState(23);
  const [recorte, setRecorte] = useState("");
  const [normalizar, setNormalizar] = useState(false);
  const [subiendo, setSubiendo] = useState<{ nombre: string; pct: number } | null>(null);
  const [encima, setEncima] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sondeo mientras haya algo vivo: 900 ms es suficiente para una barra que se
  // mueve y no llena el log del servidor con peticiones.
  useEffect(() => {
    let vivo = true;
    const mirar = () => {
      fetch("/api/taller").then((r) => r.json()).then((d) => { if (vivo) setTareas(d.tareas ?? []); }).catch(() => {});
    };
    mirar();
    const t = setInterval(() => {
      // Solo se sondea si hay algo en marcha o recién hecho (para no gastar de fondo).
      if (!vivo) return;
      mirar();
    }, 900);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // El formato se DERIVA del destino: si eliges vídeo y tenías MP3, el primero
  // válido pasa a ser el activo. Sin efecto ni estado duplicado, que es lo que
  // provocaba renders en cascada.
  const formatos: readonly string[] = destino === "video" ? VIDEO : destino === "audio" ? AUDIO : [...VIDEO, ...AUDIO];
  const formato = formatos.includes(elegido) ? elegido : formatos[0];
  const setFormato = setElegido;

  /** «1:00-2:30» → { desde: 60, hasta: 150 }. Sin recorte, null y null. */
  const segundos = (txt: string): { desde: number | null; hasta: number | null } => {
    const m = /^\s*([\d:]+)\s*-\s*([\d:]+)\s*$/.exec(txt);
    if (!m) return { desde: null, hasta: null };
    const aSeg = (t: string) => {
      if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) return null;
      return t.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
    };
    const d = aSeg(m[1]), h = aSeg(m[2]);
    return d != null && h != null && h > d ? { desde: d, hasta: h } : { desde: null, hasta: null };
  };

  const subir = useCallback((file: File) => {
    setSubiendo({ nombre: file.name, pct: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/taller/subir");
    xhr.setRequestHeader("x-linyue", "1");
    xhr.setRequestHeader("x-nombre", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-destino", destino);
    xhr.setRequestHeader("x-formato", formato);
    xhr.setRequestHeader("x-crf", String(crf));
    const r = segundos(recorte);
    if (r.desde != null) xhr.setRequestHeader("x-desde", String(r.desde));
    if (r.hasta != null) xhr.setRequestHeader("x-hasta", String(r.hasta));
    if (normalizar) xhr.setRequestHeader("x-normalizar", "1");
    // Progreso de SUBIDA real: con archivos de 2 GB esto tarda y hay que verlo.
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setSubiendo({ nombre: file.name, pct: Math.round((e.loaded / e.total) * 100) }); };
    xhr.onload = () => {
      setSubiendo(null);
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) { toast({ kind: "err", title: "No se pudo añadir", body: d.error }); return; }
        setTareas(d.tareas ?? []);
        sfx.success();
        toast({ kind: "ok", title: "En la cola del taller", body: file.name });
      } catch { toast({ kind: "err", title: "Respuesta inesperada del servidor" }); }
    };
    xhr.onerror = () => { setSubiendo(null); toast({ kind: "err", title: "Se cortó la subida", body: file.name }); };
    xhr.send(file);
  }, [destino, formato, crf, normalizar, recorte, toast]);

  const alSoltar = (e: React.DragEvent) => {
    e.preventDefault(); setEncima(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    for (const f of files) subir(f);
  };

  const quitar = async (id: string, cancelar = false) => {
    const r = await fetch(`/api/taller?id=${id}${cancelar ? "&cancelar=1" : ""}`, { method: "DELETE", headers: { "x-linyue": "1" } });
    const d = await r.json();
    if (d.tareas) setTareas(d.tareas);
  };

  return (
    <div className="space-y-5">
      <Panel className="p-5 sm:p-6">
        <h1 className="display text-2xl font-semibold tracking-tight">Taller</h1>
        <p className="muted mt-1 max-w-2xl text-sm">
          Archivos que ya tienes en el equipo: conviértelos, recórtalos o comprímelos sin volver a descargarlos.
          El original nunca se toca —la salida lleva «(taller)» en el nombre.
        </p>

        {/* Zona de arrastre */}
        <div
          onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={alSoltar}
          onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center transition-colors sq"
          style={{
            borderColor: encima ? "var(--red)" : "var(--line)",
            background: encima ? "color-mix(in oklab, var(--red) 8%, transparent)" : "var(--fill)",
          }}
        >
          <Upload size={22} strokeWidth={1.3} style={{ color: encima ? "var(--red)" : "var(--muted-ink)" }} />
          <div className="text-sm font-medium">{subiendo ? `Subiendo ${subiendo.nombre} · ${subiendo.pct}%` : "Arrastra un archivo aquí"}</div>
          <div className="muted mono text-[11px]">o pulsa para elegirlo · vídeo, audio, cualquiera que ffmpeg entienda</div>
          <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
        </div>

        {/* Opciones */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="muted text-xs">Qué hacer</span>
          {DESTINOS.map((d) => (
            <button key={d.id} onClick={() => { sfx.tick(); setDestino(d.id); }} title={d.hint} aria-pressed={destino === d.id}
              className={`btn sq-pill px-3 py-1.5 text-xs ${destino === d.id ? "btn-primary" : "btn-glass"}`}>{d.label}</button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="muted text-xs">Formato</span>
          {formatos.map((f) => (
            <button key={f} onClick={() => setFormato(f)} aria-pressed={formato === f}
              className={`btn sq-pill px-3 py-1 text-xs uppercase mono ${formato === f ? "btn-primary" : "btn-glass"}`}>{f}</button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="muted flex items-center gap-2 text-xs">
            <Scissors size={13} strokeWidth={1.5} />Recorte
            <input value={recorte} onChange={(e) => setRecorte(e.target.value)} placeholder="1:00-2:30 · vacío = todo"
              className="mono w-[150px] px-2.5 py-1 text-xs outline-none sq-pill"
              style={{ background: "var(--fill)", border: "1px solid var(--line)", color: "var(--fg)" }} />
          </label>
          {destino === "video" && (
            <label className="muted flex items-center gap-2 text-xs">
              Calidad
              <input type="range" min={18} max={32} value={crf} onChange={(e) => setCrf(Number(e.target.value))} className="w-28 accent-[var(--red)]" />
              <span className="mono text-[11px]">CRF {crf}</span>
            </label>
          )}
          <label className="muted flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={normalizar} onChange={(e) => setNormalizar(e.target.checked)} className="accent-[var(--red)]" />
            Normalizar volumen
          </label>
        </div>
        <p className="muted mt-2 text-[11px]">
          CRF bajo = más calidad y más peso. 23 es el equilibrio de siempre; 28 para mandar por WhatsApp.
          {destino === "copia" && " Con «sin recodificar» no se gana calidad: solo cambia la caja o recorta."}
        </p>
      </Panel>

      <Panel className="p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tick text-lg font-semibold tracking-tight">Trabajos</h2>
          {tareas.some((t) => t.state === "done" || t.state === "error" || t.state === "canceled") && (
            <button onClick={async () => { for (const t of tareas.filter((x) => ["done", "error", "canceled"].includes(x.state))) await quitar(t.id); }} className="btn btn-glass sq-pill px-3 py-1.5 text-xs">
              <Trash2 size={13} strokeWidth={1.5} />Limpiar terminados
            </button>
          )}
        </div>
        {tareas.length === 0 ? (
          <p className="muted text-xs">Nada por aquí. Suelta un archivo arriba y aparecerá con su progreso.</p>
        ) : (
          <ul className="space-y-2">
            {tareas.map((t) => (
              <li key={t.id} className="scrim flex items-center gap-3 border border-[var(--line)] p-3 sq-sm">
                {t.destino === "audio" ? <Music2 size={15} strokeWidth={1.5} className="muted shrink-0" /> : <FileVideo size={15} strokeWidth={1.5} className="muted shrink-0" />}
                <Ring value={t.state === "done" ? 100 : t.percent} speed={0} size={38}
                  color={t.state === "error" ? "var(--danger-ink)" : t.state === "done" ? "var(--ok-ink)" : "var(--red)"}>
                  {t.state === "done" ? "✓" : `${Math.round(t.percent)}`}
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.nombre}</div>
                  <div className="mono muted truncate text-[11px]">
                    {ESTADO[t.state]} · {t.formato.toUpperCase()}{t.destino === "video" ? ` · CRF ${t.crf ?? 23}` : ""}
                    {t.bytes ? ` · ${fmtBytes(t.bytes)}` : ""}{t.speed ? ` · ${t.speed}` : ""}
                    {t.error ? ` · ${t.error}` : ""}
                  </div>
                </div>
                {t.state === "running" && (
                  <span className="mono muted text-[11px]"><Loader2 size={13} className="animate-spin" /></span>
                )}
                {t.state === "done" && t.salida && (
                  <button aria-label="Abrir carpeta" onClick={async () => {
                    const r = await fetch("/api/taller/abrir", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ id: t.id }) });
                    if (!r.ok) toast({ kind: "err", title: "No se pudo abrir la carpeta" });
                  }} className="btn btn-glass h-9 w-9 sq-pill"><FolderOpen size={15} /></button>
                )}
                {t.state === "queued" && <button aria-label="Convertir ya" disabled className="btn btn-glass h-9 w-9 sq-pill"><Play size={14} /></button>}
                <button aria-label="Quitar" onClick={() => void quitar(t.id, t.state === "running" || t.state === "queued")} className="btn btn-glass h-9 w-9 sq-pill"><X size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
