"use client";
// Estado global de la app: cola por SSE, motores, toasts que nacen de la isla, tema y sonido.
import { emitPref, guardarModo, guardarSilencio, guardarTema, mutedSnap, subscribePref, temaSnap, themeSnap } from "@/lib/client/prefs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { setMuted, sfx } from "@/lib/client/sound";
import { avisar } from "@/lib/client/notify";
import type { EngineView, JobView } from "@/lib/client/types";
import { normalizarTema, varsDeTema, TEMA_DEFECTO, type Tema } from "@/lib/shared/tema";

export interface Toast { id: number; kind: "ok" | "err" | "info"; title: string; body?: string }
interface Ctx {
  jobs: JobView[];
  engines: EngineView[];
  rescan: () => Promise<void>;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  /** Color y movimiento elegidos en Ajustes (localStorage, sin servidor). */
  tema: Tema;
  setTema: (t: Tema) => void;
  muted: boolean;
  toggleMute: () => void;
  confetti: number;
  jobAction: (id: string, action: string, to?: number) => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error("AppProvider ausente"); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [engines, setEngines] = useState<EngineView[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const theme = useSyncExternalStore(subscribePref, themeSnap, () => "dark" as const);
  const muted = useSyncExternalStore(subscribePref, mutedSnap, () => false);
  const tema = useSyncExternalStore(subscribePref, temaSnap, () => TEMA_DEFECTO);
  // Aplicar color/movimiento: variables CSS + atributo para el CSS de fluidez.
  useEffect(() => {
    const raiz = document.documentElement;
    for (const [k, v] of Object.entries(varsDeTema(tema))) raiz.style.setProperty(k, v);
    raiz.dataset.fluidez = tema.fluidez;
    // La aurora WebGL (Ambient) escucha este evento para recolorear su shader.
    dispatchEvent(new CustomEvent("ly-tema", { detail: tema }));
  }, [tema]);
  const setTema = useCallback((t: Tema) => guardarTema(normalizarTema(t)), []);
  const [confetti, setConfetti] = useState(0);
  // Avisos del sistema: el permiso se pide en Ajustes (dentro de un clic), aquí
  // solo se consulta si están activados en config.json.
  const notificar = useRef(false);
  useEffect(() => {
    const leer = () => fetch("/api/config").then((r) => r.json()).then((c) => { notificar.current = !!c.notify; }).catch(() => {});
    leer();
    // Se refresca al volver a la pestaña: si activas los avisos en Ajustes y
    // vuelves, no hace falta recargar.
    const onVis = () => { if (!document.hidden) leer(); };
    addEventListener("visibilitychange", onVis);
    return () => removeEventListener("visibilitychange", onVis);
  }, []);
  const tid = useRef(0);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++tid.current;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    if (t.kind === "ok") sfx.success(); else if (t.kind === "err") sfx.error(); else sfx.tick();
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 4200);
  }, []);

  // Sincroniza sistemas externos (clase del <html> y módulo de sonido) con las
  // preferencias ya resueltas por useSyncExternalStore. Sin setState de React aquí.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    setMuted(muted);
  }, [theme, muted]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    const apply = () => { document.documentElement.classList.toggle("light", next === "light"); guardarModo(next); };
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(apply); else apply();
    sfx.pop();
  }, [theme]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next); // módulo de sonido
    guardarSilencio(next);
  }, [muted]);

  const rescan = useCallback(async () => {
    const r = await fetch("/api/engines", { method: "POST", headers: { "x-linyue": "1" } });
    setEngines(await r.json());
  }, []);

  // Conexión SSE con reconexión automática del propio EventSource
  useEffect(() => {
    fetch("/api/engines").then((r) => r.json()).then(setEngines).catch(() => {});
    const es = new EventSource("/api/events");
    es.addEventListener("jobs", (e) => setJobs(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("done", (e) => { const d = JSON.parse((e as MessageEvent).data); toast({ kind: "ok", title: "Descarga lista", body: d.title }); setConfetti((c) => c + 1); if (notificar.current) avisar("Descarga lista", d.title); });
    es.addEventListener("error", (e) => { const m = (e as MessageEvent).data; if (m) { const d = JSON.parse(m); toast({ kind: "err", title: "Falló la descarga", body: d.error }); if (notificar.current) avisar("Falló una descarga", d.error); } });
    return () => es.close();
  }, [toast]);

  const jobAction = useCallback(async (id: string, action: string, to?: number) => {
    sfx.pop();
    await fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ action, to }) });
  }, []);

  // Valor MEMOIZADO. Sin esto el objeto literal cambiaba de identidad en cada
  // render y React re-renderizaba a TODOS los consumidores (la cola completa,
  // las 7 tarjetas de modo, los chips…) cada vez que llegaba un evento SSE,
  // o sea 10 veces por segundo durante una descarga. Era el grueso del lag.
  const value = useMemo<Ctx>(
    () => ({ jobs, engines, rescan, toasts, toast, theme, toggleTheme, tema, setTema, muted, toggleMute, confetti, jobAction }),
    [jobs, engines, rescan, toasts, toast, theme, toggleTheme, tema, setTema, muted, toggleMute, confetti, jobAction],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
