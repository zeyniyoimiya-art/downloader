// Color y movimiento: lo único que la app deja «tocar» del sistema visual.
//
// Todo el diseño sale de unas pocas variables CSS (--acento, --acento-2,
// --brillo, --dur). Este módulo las genera a partir de una elección del usuario
// y valida lo que llega de fuera: un hex mal escrito no debe dejar la interfaz
// transparente ni sin acento.

export type Fluidez = "extrema" | "suave" | "ninguna";

export interface Tema {
  /** Color principal (hairlinas, foco, estados, datos). */
  acento: string;
  /** Segundo color: sólo para degradados y brillos. */
  acento2: string;
  /** 0..100. Cuánto brilla el acento (halos, sombras, aurora). */
  brillo: number;
  /** Cuántos milisegundos respiran las transiciones. */
  fluidez: Fluidez;
}

export interface Preset extends Tema {
  id: string;
  nombre: string;
}

export const TEMA_DEFECTO: Tema = { acento: "#e1122b", acento2: "#ff2d45", brillo: 62, fluidez: "extrema" };

/** Paletas pensadas para carbón (#050506) y para el tema claro. */
export const PRESETS: Preset[] = [
  // El primero ES el tema de fábrica: si se toca aquí, hay que tocar TEMA_DEFECTO.
  { id: "carmesi", nombre: "Carmesí", acento: "#e1122b", acento2: "#ff2d45", brillo: 62, fluidez: "extrema" },
  { id: "hielo", nombre: "Hielo", acento: "#38bdf8", acento2: "#7dd3fc", brillo: 58, fluidez: "extrema" },
  { id: "jade", nombre: "Jade", acento: "#10b981", acento2: "#34d399", brillo: 54, fluidez: "extrema" },
  { id: "ambar", nombre: "Ámbar", acento: "#f59e0b", acento2: "#fbbf24", brillo: 58, fluidez: "extrema" },
  { id: "violeta", nombre: "Violeta", acento: "#8b5cf6", acento2: "#c4b5fd", brillo: 60, fluidez: "extrema" },
  { id: "rosa", nombre: "Rosa", acento: "#f43f5e", acento2: "#fda4af", brillo: 60, fluidez: "extrema" },
  { id: "oro", nombre: "Oro", acento: "#d4af37", acento2: "#f0dc82", brillo: 56, fluidez: "suave" },
  { id: "menta", nombre: "Menta", acento: "#2dd4bf", acento2: "#99f6e4", brillo: 52, fluidez: "extrema" },
  { id: "grafito", nombre: "Grafito", acento: "#94a3b8", acento2: "#cbd5e1", brillo: 40, fluidez: "suave" },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function esHex(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/** “#ABCDEF” → “#abcdef”. Devuelve null si no es un color válido. */
export function normalizarHex(v: unknown): string | null {
  if (!esHex(v)) return null;
  return v.toLowerCase();
}

/** Mezcla defensiva: acepta un objeto a medias (config viejo, json roto…). */
export function normalizarTema(v: unknown): Tema {
  const o = (v ?? {}) as Partial<Record<keyof Tema, unknown>>;
  const fluidez: Fluidez = o.fluidez === "suave" || o.fluidez === "ninguna" || o.fluidez === "extrema" ? o.fluidez : TEMA_DEFECTO.fluidez;
  const brilloNum = typeof o.brillo === "number" && Number.isFinite(o.brillo) ? Math.round(o.brillo) : TEMA_DEFECTO.brillo;
  return {
    acento: normalizarHex(o.acento) ?? TEMA_DEFECTO.acento,
    acento2: normalizarHex(o.acento2) ?? TEMA_DEFECTO.acento2,
    brillo: Math.max(0, Math.min(100, brilloNum)),
    fluidez,
  };
}

/** Duración base de las transiciones según el ajuste de fluidez. */
export function duracionDe(fluidez: Fluidez): string {
  if (fluidez === "extrema") return "620ms";
  if (fluidez === "suave") return "380ms";
  return "1ms";
}

/** Variables CSS que se escriben en <html>. */
export function varsDeTema(t: Tema): Record<string, string> {
  const n = normalizarTema(t);
  return {
    "--acento": n.acento,
    "--acento-2": n.acento2,
    "--brillo": String(n.brillo / 100),
    "--dur": duracionDe(n.fluidez),
    // Tinta legible sobre un relleno de acento (botón primario): con ámbar u
    // oro el blanco desaparece, así que la decide la luminancia del color.
    "--acento-tinta": contrasteSobre(n.acento),
  };
}

/** [r, g, b] en 0..1, que es lo que espera el shader de la aurora. */
export function rgbDeHex(hex: string): [number, number, number] {
  const h = normalizarHex(hex) ?? TEMA_DEFECTO.acento;
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}

/** ¿Este tema es el de fábrica? (Para enseñar «Restablecer» sin ruido.) */
export function esTemaDefecto(t: Tema): boolean {
  const n = normalizarTema(t);
  return n.acento === TEMA_DEFECTO.acento && n.acento2 === TEMA_DEFECTO.acento2 && n.brillo === TEMA_DEFECTO.brillo && n.fluidez === TEMA_DEFECTO.fluidez;
}

/** Texto legible sobre el acento (para etiquetas dentro de un botón lleno). */
export function contrasteSobre(hex: string): "#0b0b0c" | "#ffffff" {
  const [r, g, b] = rgbDeHex(hex);
  // Luminancia relativa (sRGB) según WCAG.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 0.179 es el punto en que el negro y el blanco empatan (WCAG: L de #767676).
  // Con 0.45 el ámbar (#f59e0b, L=0.44) se quedaba con texto blanco ilegible.
  return L > 0.179 ? "#0b0b0c" : "#ffffff";
}

/** Tono (0..360) y saturación (%) del acento, para partículas y confeti. */
export function hslDeHex(hex: string): { h: number; s: number } {
  const [r, g, b] = rgbDeHex(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(Math.min(1, s) * 100) };
}
