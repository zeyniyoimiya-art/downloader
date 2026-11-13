"use client";
// Piezas reutilizables: logo "L" que respira, anillo de progreso, odómetro, segmented control con pill elástica.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { sfx } from "@/lib/client/sound";

/**
 * Marca: placa negra con filete carmesí y la «L» en rojo apagado.
 * Sin degradados de arcoíris ni brillos: la marca es una placa de máquina.
 */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center font-bold sq-sm"
      style={{
        width: size, height: size, fontSize: size * 0.46,
        color: "var(--red)",
        background: "linear-gradient(180deg, #131315, #08080a)",
        border: "1px solid var(--stroke)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 10px 24px -14px rgba(0,0,0,.95)",
        letterSpacing: "-0.06em",
        position: "relative",
      }}
    >
      L
      <span aria-hidden style={{ position: "absolute", left: 6, right: 6, bottom: 4, height: 1, background: "linear-gradient(90deg, transparent, var(--red), transparent)" }} />
    </div>
  );
}

// Anillo de progreso que "respira" más rápido cuanto mayor es la velocidad real
export function Ring({ value, size = 34, speed = 0, color = "var(--red)", children }: { value: number; size?: number; speed?: number; color?: string; children?: ReactNode }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  const breath = speed > 0 ? Math.max(0.6, 3 - Math.log10(speed + 1) / 3) : 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" style={breath ? { animation: `breathe ${breath}s ease-in-out infinite` } : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity=".16" strokeWidth="2" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ transition: "stroke-dashoffset 600ms var(--spring)" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold">{children}</div>
    </div>
  );
}

// Odómetro: cada dígito es una columna que se desliza con spring
export function Odometer({ value }: { value: number }) {
  const s = String(Math.max(0, Math.floor(value)));
  return (
    <span className="odo mono tabular-nums" aria-label={s}>
      {s.split("").map((d, i) => (
        <span key={s.length - i} style={{ transform: `translateY(-${+d}em)` }} aria-hidden>
          {Array.from({ length: 10 }, (_, k) => <span key={k} style={{ height: "1em" }}>{k}</span>)}
        </span>
      ))}
    </span>
  );
}

// Segmented control de vidrio: la pill se desliza y se estira (morph) entre opciones
export function Segmented<T extends string>({ options, value, onChange, className = "" }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const [stretch, setStretch] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-v="${CSS.escape(value)}"]`);
    if (el) { setStretch(true); setPill({ left: el.offsetLeft, width: el.offsetWidth }); const t = setTimeout(() => setStretch(false), 180); return () => clearTimeout(t); }
  }, [value, options.length]);
  // Navegación con teclado digna de un tablist: ←/→ mueven la selección, Home/End
  // van a los extremos y el foco sigue a la pill. Antes solo se podía con Tab y
  // Enter, y un lector de pantalla no tenía forma de recorrer las pestañas.
  const goto = (i: number) => {
    if (!options.length) return;
    const opt = options[(i + options.length) % options.length];
    if (opt.value !== value) { sfx.tick(); onChange(opt.value); }
    wrap.current?.querySelector<HTMLElement>(`[data-v="${CSS.escape(opt.value)}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goto(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goto(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); goto(0); }
    else if (e.key === "End") { e.preventDefault(); goto(options.length - 1); }
  };
  return (
    <div ref={wrap} role="tablist" aria-orientation="horizontal" onKeyDown={onKeyDown} className={`glass sq-pill relative flex p-1 ${className}`}>
      <span aria-hidden className="absolute top-1 bottom-1 sq-pill" style={{ left: pill.left, width: pill.width, background: "linear-gradient(180deg, rgba(225,18,43,.20), rgba(225,18,43,.08))", boxShadow: "inset 0 0 0 1px var(--red-line), 0 6px 18px -10px rgba(225,18,43,.9)", transform: stretch ? "scaleX(1.12) scaleY(.92)" : "none", transition: "left 560ms var(--spring), width 560ms var(--spring), transform 300ms var(--spring)" }} />
      {options.map((o) => (
        // tabIndex roving: solo la pestaña activa entra en el orden de tabulación,
        // y dentro del grupo se navega con las flechas (patrón WAI-ARIA).
        <button key={o.value} data-v={o.value} role="tab" aria-selected={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => { if (o.value !== value) { sfx.pop(); onChange(o.value); } }} className={`btn relative z-10 px-3.5 py-1.5 text-sm sq-pill ${o.value === value ? "" : "muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => { sfx.pop(); onChange(!checked); }} className="relative h-7 w-12 shrink-0 sq-pill transition-colors" style={{ background: checked ? "linear-gradient(180deg, var(--red-bright), var(--red-deep))" : "var(--fill-2)", boxShadow: checked ? "inset 0 0 0 1px rgba(255,255,255,.14), 0 6px 18px -10px rgba(225,18,43,.9)" : "inset 0 0 0 1px var(--stroke)" }}>
      <span className="absolute top-0.5 h-6 w-6 rounded-full" style={{ left: checked ? 22 : 2, background: checked ? "#fff" : "var(--muted)", transition: "left 500ms var(--spring)" }} />
    </button>
  );
}

export function Panel({ children, className = "", tilt = false }: { children: ReactNode; className?: string; tilt?: boolean }) {
  return <section data-tilt={tilt ? "" : undefined} className={`glass sq ${className}`}>{children}</section>;
}
