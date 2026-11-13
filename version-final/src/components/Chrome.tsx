"use client";
// Cromo de la app: header con marca, tab bar de vidrio (abajo en móvil), Dynamic Island de descargas y banners.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Cookie, Download, Moon, Pause, Play, Settings, Sun, Volume2, VolumeX, X, AlertTriangle, Info } from "lucide-react";
import { useApp } from "./AppProvider";
import { Logo, Ring, Segmented } from "./ui";
import { fmtBytes } from "@/lib/shared/progress";

const TABS = [
  { href: "/", label: "Descargador", icon: Download },
  { href: "/recientes", label: "Recientes", icon: Clock },
  { href: "/cookies", label: "Cookies", icon: Cookie },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export function Chrome() {
  const path = usePathname();
  const router = useRouter();
  const { theme, toggleTheme, muted, toggleMute } = useApp();
  const current = TABS.find((t) => t.href === path)?.href ?? "";

  // Atajos de teclado: Alt+1..4 navega entre pestañas
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.altKey && /^[1-4]$/.test(e.key)) router.push(TABS[+e.key - 1].href); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [router]);

  return (
    <>
      <header className="sticky top-0 z-40 mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Linyue inicio">
          <Logo />
          <div className="leading-tight"><div className="font-semibold tracking-tight">Linyue</div><div className="muted text-[11px]">Descargador universal local</div></div>
        </Link>
        <div className="hidden md:block">
          <Segmented options={TABS.map((t) => ({ value: t.href, label: <span className="flex items-center gap-1.5"><t.icon size={15} strokeWidth={1.5} className="ico" />{t.label}</span> }))} value={current} onChange={(v) => router.push(v)} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar"} className="btn btn-glass h-10 w-10 sq-pill">{muted ? <VolumeX size={17} strokeWidth={1.5} className="ico" /> : <Volume2 size={17} strokeWidth={1.5} className="ico" />}</button>
          <button onClick={toggleTheme} aria-label="Cambiar tema" className="btn btn-glass h-10 w-10 sq-pill">{theme === "dark" ? <Sun size={17} strokeWidth={1.5} className="ico" /> : <Moon size={17} strokeWidth={1.5} className="ico" />}</button>
        </div>
      </header>
      {/* Tab bar flotante inferior en móvil */}
      <nav className="fixed inset-x-3 bottom-3 z-40 md:hidden">
        <div className="glass glass-strong sq flex justify-around p-1.5">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`btn flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] sq-sm ${current === t.href ? "bg-[var(--fill-2)]" : "muted"}`}>
              <t.icon size={20} strokeWidth={1.5} />{t.label}
            </Link>
          ))}
        </div>
      </nav>
      <Island />
    </>
  );
}

function Island() {
  const { jobs, toasts, engines, jobAction } = useApp();
  const [open, setOpen] = useState(false);
  const live = useMemo(() => jobs.filter((j) => ["queued", "probing", "running", "post", "paused"].includes(j.state)), [jobs]);
  const speed = live.reduce((a, j) => a + (j.state === "running" ? j.speed : 0), 0);
  const avg = live.length ? live.reduce((a, j) => a + j.percent, 0) / live.length : 0;
  const engineDown = engines.some((e) => e.health === "down");
  const expanded = open && live.length > 0;
  const toggle = () => {
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(() => setOpen((o) => !o)); else setOpen((o) => !o);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2">
      <div
        role="button" tabIndex={0} aria-expanded={expanded} aria-label="Isla de descargas"
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={toggle} onKeyDown={(e) => e.key === "Enter" && toggle()}
        className={`pointer-events-auto overflow-hidden text-white ${engineDown ? "amber" : ""}`}
        style={{
          viewTransitionName: "island", background: "rgba(0,0,0,.82)", backdropFilter: "blur(30px) saturate(180%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.15), 0 12px 40px -10px rgba(0,0,0,.6)",
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
              <span className="mx-auto flex items-center gap-1.5 text-white/75"><span className={`h-1.5 w-1.5 rounded-full ${engineDown ? "bg-amber-400" : "bg-emerald-400"}`} />{engineDown ? "motor caído" : "en reposo"}</span>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-xs text-white/70"><span>Cola activa</span><span className="mono">{fmtBytes(speed)}/s total</span></div>
            <div className="flex-1 space-y-1.5 overflow-auto">
              {live.map((j) => (
                <div key={j.id} className="flex items-center gap-3 rounded-2xl bg-white/[.06] p-2 land">
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
      {/* Banners iOS que nacen de la isla */}
      <div aria-live="polite" className="flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="banner-in glass glass-strong pointer-events-auto flex w-[min(380px,92vw)] items-start gap-3 p-3 sq-sm" style={{ transformOrigin: "top center" }}>
            {t.kind === "ok" ? <CheckCircle2 className="mt-0.5 text-emerald-400" size={20} strokeWidth={1.5} /> : t.kind === "err" ? <AlertTriangle className="mt-0.5 text-rose-400" size={20} strokeWidth={1.5} /> : <Info className="mt-0.5 text-violet-300" size={20} strokeWidth={1.5} />}
            <div className="min-w-0"><div className="text-sm font-semibold">{t.title}</div>{t.body && <div className="muted line-clamp-2 text-xs">{t.body}</div>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
