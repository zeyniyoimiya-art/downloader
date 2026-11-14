"use client";
// Cromo de la app: header con marca, tab bar de vidrio (abajo en móvil), Dynamic Island de descargas y banners.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Cookie, Download, Info, Moon, Pause, Play, Scissors, Settings, Sun, Volume2, VolumeX, X } from "lucide-react";
import { useApp } from "./AppProvider";
import { Logo, Ring, Segmented } from "./ui";
import { fmtBytes } from "@/lib/shared/progress";

const TABS = [
  { href: "/", label: "Descargador", icon: Download },
  { href: "/recientes", label: "Recientes", icon: Clock },
  { href: "/taller", label: "Taller", icon: Scissors },
  { href: "/estadisticas", label: "Datos", icon: BarChart3 },
  { href: "/cookies", label: "Cookies", icon: Cookie },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export function Chrome() {
  const path = usePathname();
  const router = useRouter();
  const { theme, toggleTheme, muted, toggleMute } = useApp();
  const current = TABS.find((t) => t.href === path)?.href ?? "";

  // Atajos de teclado: Alt+1..6 navega entre pestañas
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.altKey && /^[1-6]$/.test(e.key)) router.push(TABS[+e.key - 1].href); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [router]);

  return (
    <>
      <header
        className="sticky top-0 z-40 mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-4 pb-3 sm:px-6"
        style={{
          background: "linear-gradient(180deg, color-mix(in oklab, var(--bg) 94%, transparent) 0%, color-mix(in oklab, var(--bg) 78%, transparent) 70%, transparent 100%)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="Linyue inicio">
          <Logo />
          <div className="leading-tight">
            <div className="font-semibold tracking-[-0.02em]">Linyue</div>
            <div className="label mt-1 hidden sm:block">Descargador universal · local</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {/* Las pestañas van en el bloque DERECHO, no centradas: la isla flota
              fija en el centro superior y las tapaba (se comía "Recientes").
              Se muestran a partir de xl, donde ya no hay riesgo de choque; por
              debajo de eso manda la barra inferior. */}
          <div className="hidden xl:block">
            <Segmented options={TABS.map((t) => ({ value: t.href, label: <span className="flex items-center gap-1.5"><t.icon size={15} strokeWidth={1.5} className="ico" />{t.label}</span> }))} value={current} onChange={(v) => router.push(v)} />
          </div>
          <button onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar"} className="btn btn-glass h-10 w-10 sq-pill">{muted ? <VolumeX size={17} strokeWidth={1.5} className="ico" /> : <Volume2 size={17} strokeWidth={1.5} className="ico" />}</button>
          <button onClick={toggleTheme} aria-label="Cambiar tema" className="btn btn-glass h-10 w-10 sq-pill">{theme === "dark" ? <Sun size={17} strokeWidth={1.5} className="ico" /> : <Moon size={17} strokeWidth={1.5} className="ico" />}</button>
        </div>
      </header>
      {/* Tab bar flotante inferior en móvil */}
      <nav className="fixed inset-x-3 bottom-3 z-40 xl:hidden">
        <div className="tabbar sq flex justify-around p-1.5">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`btn relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] tracking-wide sq-sm ${current === t.href ? "" : "muted"}`}
              style={current === t.href ? { color: "var(--fg)" } : undefined}>
              <t.icon size={19} strokeWidth={1.5} style={current === t.href ? { color: "var(--red)" } : undefined} />{t.label}
              {current === t.href && <span aria-hidden style={{ position: "absolute", top: 0, left: 18, right: 18, height: 1, background: "linear-gradient(90deg,transparent,var(--red),transparent)" }} />}
            </Link>
          ))}
        </div>
      </nav>
      <Island />
      <ApagadoBanner />
    </>
  );
}

/**
 * Aviso de «el equipo se apagará en N s» con botón para cancelar.
 *
 * Va en su propio componente y sondea `/api/power` cada 5 s en vez de meterse
 * en el SSE: así el estado del apagado no depende de que la conexión de eventos
 * esté viva (justo cuando más falta hace es al final de la cola).
 */
function ApagadoBanner() {
  const [en, setEn] = useState<number | null>(null);
  const [queda, setQueda] = useState(0);
  useEffect(() => {
    let vivo = true;
    const mirar = () => fetch("/api/power").then((r) => r.json()).then((d: { en: number | null }) => { if (vivo) setEn(d.en); }).catch(() => {});
    mirar();
    const t = setInterval(mirar, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!en) return;
    const tick = () => setQueda(Math.max(0, Math.round((en - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [en]);
  if (!en) return null;
  const cancelar = async () => {
    await fetch("/api/power", { method: "POST", headers: { "Content-Type": "application/json", "x-linyue": "1" }, body: JSON.stringify({ action: "cancelar" }) });
    setEn(null);
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <div className="banner-in pointer-events-auto flex items-center gap-3 px-4 py-2.5 sq-pill" style={{ background: "rgba(6,6,7,.96)", border: "1px solid var(--red-line)", boxShadow: "0 20px 50px -20px rgba(0,0,0,.9), 0 0 30px -14px var(--red)" }}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--red)", boxShadow: "0 0 10px var(--red)" }} />
        <span className="text-xs text-white/85">
          La cola terminó · el equipo se apaga en <span className="num font-semibold text-white">{queda}</span> s
        </span>
        <button onClick={cancelar} className="btn sq-pill px-3 py-1 text-[11px] font-semibold" style={{ background: "var(--red)", color: "#fff" }}>Cancelar apagado</button>
      </div>
    </div>
  );
}

function Island() {
  const { jobs, toasts, engines, jobAction } = useApp();
  const [open, setOpen] = useState(false);
  const live = useMemo(() => jobs.filter((j) => ["queued", "probing", "running", "post", "paused"].includes(j.state)), [jobs]);
  const speed = live.reduce((a, j) => a + (j.state === "running" ? j.speed : 0), 0);
  const avg = live.length ? live.reduce((a, j) => a + j.percent, 0) / live.length : 0;
  // «motor caído» a secas no decía nada: ¿cuál? Ahora se nombra el que falta.
  const caidos = engines.filter((e) => e.health === "down");
  const engineDown = caidos.length > 0;
  const etiquetaMotor = caidos.length === 1 ? `falta ${caidos[0].exe}` : `faltan ${caidos.length} motores`;
  const expanded = open && live.length > 0;
  const toggle = () => {
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(() => setOpen((o) => !o)); else setOpen((o) => !o);
  };

  // La isla va ARRIBA en móvil y CENTRO-ABAJO en escritorio: en el header de
  // escritorio viven las pestañas, y cualquier cosa centrada arriba choca con
  // ellas (medido: a 1280 px el pill se comía "Descargador"). Abajo, sobre el
  // vacío, no estorba a nadie. Los banners van en su propio contenedor fijo.
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-50 flex flex-col items-center gap-2 xl:bottom-5">
      <div
        role="button" tabIndex={0} aria-expanded={expanded} aria-label="Isla de descargas"
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={toggle} onKeyDown={(e) => e.key === "Enter" && toggle()}
        className={`pointer-events-auto overflow-hidden text-white ${engineDown ? "amber" : ""}`}
        style={{
          viewTransitionName: "island", background: "rgba(6,6,7,.94)", backdropFilter: "blur(14px)",
          border: "1px solid var(--stroke)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 20px 50px -18px rgba(0,0,0,.9), 0 0 24px -12px rgba(225,18,43,.8)",
          width: expanded ? "min(440px, 94vw)" : live.length ? 210 : 128, height: expanded ? Math.min(80 + live.length * 58, 380) : 36,
          borderRadius: expanded ? 32 : 999, transition: "width 650ms var(--spring), height 650ms var(--spring), border-radius 650ms var(--spring)",
        }}
      >
        {!expanded ? (
          <div className="flex h-9 items-center justify-between gap-2 px-3 text-xs">
            {live.length ? (
              <>
                <Ring value={avg} size={22} speed={speed}><span /></Ring>
                <span className="font-semibold">{live.length} activa{live.length > 1 ? "s" : ""}</span>
                <span className="mono text-white/70">{fmtBytes(speed)}/s</span>
              </>
            ) : (
              <span className="mx-auto flex items-center gap-1.5 whitespace-nowrap text-white/70" title={caidos.map((e) => e.exe).join(", ")}><span className="h-1.5 w-1.5 rounded-full" style={{ background: engineDown ? "var(--warn-ink)" : "var(--red)", boxShadow: `0 0 8px ${engineDown ? "var(--warn-ink)" : "var(--red)"}` }} />{engineDown ? etiquetaMotor : "en reposo"}</span>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-xs text-white/70"><span>Cola activa</span><span className="mono">{fmtBytes(speed)}/s total</span></div>
            <div className="flex-1 space-y-1.5 overflow-auto">
              {live.map((j) => (
                <div key={j.id} className="flex items-center gap-3 sq-sm bg-white/[.05] p-2 land">
                  <Ring value={j.percent} speed={j.speed}>{Math.round(j.percent)}</Ring>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{j.title}</div>
                    <div className="mono truncate text-[11px] text-white/55">{j.engine} · {j.state === "running" ? `${fmtBytes(j.speed)}/s · ETA ${j.eta || "—"}` : j.state}</div>
                  </div>
                  <button aria-label={j.state === "paused" ? "Reanudar" : "Pausar"} onClick={() => jobAction(j.id, j.state === "paused" ? "resume" : "pause")} className="btn h-8 w-8 rounded-full bg-white/10">{j.state === "paused" ? <Play size={14} /> : <Pause size={14} />}</button>
                  <button aria-label="Cancelar" onClick={() => jobAction(j.id, "cancel")} className="btn h-8 w-8 rounded-full bg-white/10"><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
      {/* Banners: contenedor propio para que no se muevan cuando la isla cambia
          de sitio entre móvil y escritorio. aria-live sigue aquí. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="banner-in glass glass-strong pointer-events-auto flex w-[min(380px,92vw)] items-start gap-3 p-3 sq-sm" style={{ transformOrigin: "top center" }}>
            {t.kind === "ok" ? <CheckCircle2 className="mt-0.5" style={{ color: "var(--ok-ink)" }} size={20} strokeWidth={1.5} /> : t.kind === "err" ? <AlertTriangle className="mt-0.5" style={{ color: "var(--danger-ink)" }} size={20} strokeWidth={1.5} /> : <Info className="mt-0.5" style={{ color: "var(--accent-ink)" }} size={20} strokeWidth={1.5} />}
            <div className="min-w-0"><div className="text-sm font-semibold">{t.title}</div>{t.body && <div className="muted line-clamp-2 text-xs">{t.body}</div>}</div>
          </div>
        ))}
      </div>
    </>
  );
}
