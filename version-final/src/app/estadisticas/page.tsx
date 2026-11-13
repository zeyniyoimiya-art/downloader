"use client";
// "/estadisticas": qué has bajado de verdad. Todo se calcula desde history.json
// (nada de telemetría) y el gráfico es SVG puro: cero librerías nuevas.
import { useEffect, useState } from "react";
import { BarChart3, Flame, HardDrive, Trophy } from "lucide-react";
import { Panel } from "@/components/ui";
import { fmtBytes, fmtDuration } from "@/lib/shared/progress";
import type { Estadisticas } from "@/lib/shared/stats";

function Barra({ valor, max, color = "linear-gradient(90deg,#8b5cf6,#ec4899)" }: { valor: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 2;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]" role="presentation">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function EstadisticasPage() {
  const [d, setD] = useState<Estadisticas | null>(null);
  useEffect(() => { fetch("/api/stats").then((r) => r.json()).then(setD).catch(() => setD(null)); }, []);

  if (!d) return <div className="glass skeleton h-96 sq" />;
  if (!d.total.archivos) {
    return (
      <Panel className="p-8 text-center">
        <BarChart3 className="mx-auto mb-3 opacity-40" size={36} strokeWidth={1.5} />
        <h1 className="text-xl font-semibold">Todavía no hay nada que contar</h1>
        <p className="muted mt-1 text-sm">Baja algo y vuelve: aquí aparecerán tus GB, tus plataformas y tu racha.</p>
      </Panel>
    );
  }

  const maxDia = Math.max(...d.porDia.map((x) => x.bytes), 1);
  const maxPlat = Math.max(...d.porPlataforma.map((x) => x.bytes), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold tracking-[-0.035em]">Estadísticas</h1>
        <p className="muted mt-1 text-sm">Calculadas en tu PC desde <span className="mono">history.json</span>. Cero telemetría.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: HardDrive, label: "Descargado", valor: fmtBytes(d.total.bytes), sub: `${d.total.archivos} archivos` },
          { icon: BarChart3, label: "De vídeo/audio", valor: fmtDuration(d.total.segundos), sub: `${d.total.plataformas} plataformas` },
          { icon: Flame, label: "Racha", valor: `${d.rachaDias} día${d.rachaDias === 1 ? "" : "s"}`, sub: d.rachaDias > 1 ? "sin fallar" : "empieza hoy" },
          { icon: Trophy, label: "El más grande", valor: fmtBytes(d.mayorBytes), sub: `media ${fmtBytes(d.mediaBytes)}` },
        ].map((k) => (
          <Panel key={k.label} className="p-5">
            <div className="muted flex items-center gap-2 text-xs"><k.icon size={14} strokeWidth={1.5} />{k.label}</div>
            <div className="mt-2 text-2xl font-bold tracking-tight">{k.valor}</div>
            <div className="muted text-xs">{k.sub}</div>
          </Panel>
        ))}
      </div>

      <Panel className="p-5">
        <h2 className="mb-4 font-semibold">Últimos {d.porDia.length} días</h2>
        <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Descargas por día">
          {d.porDia.map((x) => {
            const alto = Math.max(2, Math.round((x.bytes / maxDia) * 100));
            return (
              <div key={x.dia} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${x.dia}: ${x.archivos} archivo(s) · ${fmtBytes(x.bytes)}`}>
                <div className="w-full rounded-t-md bg-gradient-to-t from-fuchsia-500/70 to-violet-400/70 transition-all group-hover:from-fuchsia-400 group-hover:to-violet-300" style={{ height: `${alto}%`, minHeight: 2 }} />
              </div>
            );
          })}
        </div>
        <div className="mono muted mt-2 flex justify-between text-[10px]">
          <span>{d.porDia[0]?.dia}</span>
          <span>{d.porDia.at(-1)?.dia}</span>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="self-start p-5">
          <h2 className="mb-3 font-semibold">Por plataforma</h2>
          <ul className="space-y-3">
            {d.porPlataforma.slice(0, 8).map((x) => (
              <li key={x.clave}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{x.clave}</span>
                  <span className="mono muted shrink-0 text-xs">{x.archivos} · {fmtBytes(x.bytes)}</span>
                </div>
                <Barra valor={x.bytes} max={maxPlat} />
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-6">
          <Panel className="p-5">
            <h2 className="mb-3 font-semibold">Por formato</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {d.porFormato.slice(0, 10).map((x) => (
                <li key={x.clave} className="flex items-baseline justify-between gap-2">
                  <span className="mono">{x.clave}</span>
                  <span className="muted text-xs">{x.archivos} · {fmtBytes(x.bytes)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-5">
            <h2 className="mb-3 font-semibold">Motores que más usas</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {d.porMotor.slice(0, 8).map((x) => (
                <li key={x.clave} className="flex items-baseline justify-between gap-2">
                  <span className="mono">{x.clave}</span>
                  <span className="muted text-xs">{x.archivos}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {!!d.topAutores.length && (
            <Panel className="p-5">
              <h2 className="mb-3 font-semibold">Top canales</h2>
              <ol className="space-y-1 text-sm">
                {d.topAutores.map((x, i) => (
                  <li key={x.clave} className="flex items-baseline justify-between gap-2">
                    <span className="truncate"><span className="mono muted mr-2">{i + 1}</span>{x.clave}</span>
                    <span className="muted shrink-0 text-xs">{fmtBytes(x.bytes)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
