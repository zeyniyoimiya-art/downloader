"use client";
// Estado global de la app: cola por SSE, motores, toasts que nacen de la isla, tema y sonido.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { setMuted, sfx } from "@/lib/client/sound";
import type { EngineView, JobView } from "@/lib/client/types";

export interface Toast { id: number; kind: "ok" | "err" | "info"; title: string; body?: string }
interface Ctx {
  jobs: JobView[];
  engines: EngineView[];
  rescan: () => Promise<void>;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  muted: boolean;
  toggleMute: () => void;
  confetti: number;
  jobAction: (id: string, action: string, to?: number) => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error("AppProvider ausente"); return c; };

// ── Preferencias locales (tema/sonido) sobre localStorage vía useSyncExternalStore.
// getServerSnapshot fijo ("dark"/false): el primer render de hidratación coincide con
// el SSR (sin flash ni mismatch de hidratación); getSnapshot lee el valor real en cliente.
const emitPref = () => { if (typeof window !== "undefined") dispatchEvent(new Event("ly-pref")); };
function subscribePref(cb: () => void) {
  const h = () => cb();
  addEventListener("ly-pref", h);
  addEventListener("storage", h); // sync entre pestañas
  return () => { removeEventListener("ly-pref", h); removeEventListener("storage", h); };
}
const themeSnap = (): "dark" | "light" => {
  if (typeof window === "undefined") return "dark";
  const t = localStorage.getItem("ly-theme") as "dark" | "light" | null;
  return t ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
};
const mutedSnap = (): boolean => typeof window !== "undefined" && localStorage.getItem("ly-muted") === "1";

export function AppProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [engines, setEngines] = useState<EngineView[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const theme = useSyncExternalStore(subscribePref, themeSnap, () => "dark" as const);
  const muted = useSyncExternalStore(subscribePref, mutedSnap, () => false);
  const [confetti, setConfetti] = useState(0);
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
    const apply = () => { document.documentElement.classList.toggle("light", next === "light"); localStorage.setItem("ly-theme", next); emitPref(); };
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(apply); else apply();
    sfx.pop();
  }, [theme]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next); // módulo de sonido
    localStorage.setItem("ly-muted", next ? "1" : "0");
    emitPref();
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
    es.addEventListener("done", (e) => { const d = JSON.parse((e as MessageEvent).data); toast({ kind: "ok", title: "Descarga lista", body: d.title }); setConfetti((c) => c + 1); });
    es.addEventListener("error", (e) => { const m = (e as MessageEvent).data; if (m) { const d = JSON.parse(m); toast({ kind: "err", title: "Falló la descarga", body: d.error }); } });
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
    () => ({ jobs, engines, rescan, toasts, toast, theme, toggleTheme, muted, toggleMute, confetti, jobAction }),
    [jobs, engines, rescan, toasts, toast, theme, toggleTheme, muted, toggleMute, confetti, jobAction],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
