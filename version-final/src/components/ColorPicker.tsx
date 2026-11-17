"use client";
// Editor de color y movimiento.
//
// Vive en Ajustes, pero no guarda nada por su cuenta: escribe en el `tema` del
// AppProvider, que lo aplica al instante (variables CSS en <html>) y lo deja en
// localStorage. Por eso aquí no hay botón «guardar»: lo que se ve es lo que hay.
import { useState } from "react";
import { RotateCcw, Check } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Panel, Segmented } from "@/components/ui";
import { sfx } from "@/lib/client/sound";
import { PRESETS, TEMA_DEFECTO, esTemaDefecto, normalizarHex, type Fluidez, type Tema } from "@/lib/shared/tema";

/** Muestra del preset: degradado con sus dos colores, no un cuadrado plano. */
function Muestra({ a, b, activo }: { a: string; b: string; activo: boolean }) {
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 place-items-center rounded-full"
      style={{
        background: `linear-gradient(135deg, ${a}, ${b})`,
        boxShadow: activo ? `0 0 0 2px var(--bg), 0 0 0 3.5px ${a}, 0 8px 22px -8px ${a}` : `inset 0 0 0 1px rgba(255,255,255,.16)`,
        transition: "box-shadow var(--dur) var(--spring), transform var(--dur) var(--spring)",
        transform: activo ? "scale(1.06)" : "none",
      }}
    >
      {activo && <Check size={13} strokeWidth={3} style={{ color: "#fff" }} />}
    </span>
  );
}

export function ColorPicker() {
  const { tema, setTema, toast } = useApp();
  const cambiar = (parcial: Partial<Tema>) => setTema({ ...tema, ...parcial });

  return (
    <Panel className="p-5">
      <h2 className="mb-1 tick font-semibold tracking-tight">Color y movimiento</h2>
      <p className="muted mb-3 text-xs">
        Un solo acento en toda la app: hairlinas, foco, datos y aurora. Se aplica al instante y se
        recuerda en este navegador.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Paletas">
        {PRESETS.map((p) => {
          const activo = tema.acento === p.acento && tema.acento2 === p.acento2;
          return (
            <button
              key={p.id}
              onClick={() => { sfx.pop(); setTema({ acento: p.acento, acento2: p.acento2, brillo: p.brillo, fluidez: tema.fluidez }); }}
              aria-pressed={activo}
              className="btn btn-glass flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
              style={activo ? { borderColor: p.acento, color: "var(--ink)" } : undefined}
            >
              <Muestra a={p.acento} b={p.acento2} activo={activo} />
              {p.nombre}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CampoColor
          etiqueta="Acento"
          valor={tema.acento}
          onCambio={(v) => cambiar({ acento: v })}
        />
        <CampoColor
          etiqueta="Segundo color"
          valor={tema.acento2}
          onCambio={(v) => cambiar({ acento2: v })}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-medium">Brillo</span>
          <span className="mono text-xs" style={{ color: "var(--accent-ink)" }}>{tema.brillo}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={tema.brillo}
          onChange={(e) => cambiar({ brillo: +e.target.value })}
          aria-label="Brillo del acento"
          className="w-full"
          style={{ accentColor: tema.acento }}
        />
        <div className="muted text-xs">Cuánto iluminan los halos y la aurora. A 0 queda plano y sobrio.</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Fluidez</div>
          <div className="muted text-xs">
            {tema.fluidez === "extrema"
              ? "muelles largos y aurora a 60 fps"
              : tema.fluidez === "suave"
                ? "transiciones cortas, aurora a 30 fps"
                : "nada se mueve"}
          </div>
        </div>
        <Segmented<Fluidez>
          options={[
            { value: "extrema", label: "Extrema" },
            { value: "suave", label: "Suave" },
            { value: "ninguna", label: "Ninguna" },
          ]}
          value={tema.fluidez}
          onChange={(v) => { sfx.tick(); cambiar({ fluidez: v }); }}
        />
      </div>

      {!esTemaDefecto(tema) && (
        <button
          onClick={() => { sfx.pop(); setTema(TEMA_DEFECTO); toast({ title: "Color restablecido", kind: "info" }); }}
          className="btn btn-glass mt-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        >
          <RotateCcw size={13} /> Restablecer
        </button>
      )}
    </Panel>
  );
}

function CampoColor({ etiqueta, valor, onCambio }: { etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  // El campo de texto NO es controlado por el color: si escribes «#38b» a medias
  // y cada tecla validara y rebotara el valor, sería imposible escribir un hex.
  // Se escribe libre, se confirma al completar seis dígitos o al salir del campo.
  // Mientras se escribe manda el borrador; al salir, manda la verdad (el color).
  // Así el campo sigue a los presets y al cuentagotas sin un efecto de por medio.
  const [borrador, setBorrador] = useState<string | null>(null);
  const texto = borrador ?? valor;
  const confirmar = () => {
    const v = normalizarHex((borrador ?? "").trim());
    if (v && v !== valor) onCambio(v);
    setBorrador(null);
  };
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2">
      <span className="text-sm">{etiqueta}</span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          value={texto}
          onChange={(e) => {
            const t = e.target.value.slice(0, 7);
            setBorrador(t);
            const v = normalizarHex(t.trim());
            if (v) onCambio(v);
          }}
          onFocus={() => setBorrador(valor)}
          onBlur={confirmar}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
          spellCheck={false}
          aria-label={`${etiqueta} en hexadecimal`}
          className="mono w-[86px] bg-transparent text-right text-xs uppercase outline-none"
        />
        {/* type="color" sólo acepta #rrggbb, que es justo lo que valida el modelo. */}
        <input
          type="color"
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          aria-label={etiqueta}
          className="h-7 w-7 cursor-pointer rounded-lg border-0 bg-transparent p-0"
          style={{ colorScheme: "dark" }}
        />
      </span>
    </label>
  );
}
