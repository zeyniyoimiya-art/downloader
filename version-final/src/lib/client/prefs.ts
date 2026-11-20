// Preferencias locales (modo, color, sonido) como store externo de React.
//
// ── EL FALLO QUE ARREGLA (fase 18.5) ────────────────────────────────────────
// `useSyncExternalStore` compara el valor de `getSnapshot()` con `Object.is`.
// Si esa función devuelve un objeto NUEVO en cada llamada, React concluye que
// el store ha cambiado en cada render y vuelve a renderizar… sin parar. Eso es
// el aviso «The result of getSnapshot should be cached to avoid an infinite
// loop» y, en producción, «Maximum update depth exceeded» (React #185), que
// tumbaba la app ENTERA con su pantalla de error: la del cartel «This page
// couldn't load / Reload to try again, or go back».
//
// Por eso el tema (el único valor que es un objeto) se cachea por el texto
// crudo de `localStorage`: mientras no cambie lo guardado se devuelve
// EXACTAMENTE la misma referencia. Las cadenas y los booleanos no lo necesitan
// (dos `"dark"` son el mismo valor), pero el objeto sí.
import { normalizarTema, TEMA_DEFECTO, type Tema } from "@/lib/shared/tema";

export const CLAVE_MODO = "ly-theme";
export const CLAVE_TEMA = "ly-tema";
export const CLAVE_SILENCIO = "ly-muted";

const hayVentana = () => typeof window !== "undefined";

/** Avisa a los suscriptores de que una preferencia cambió. */
export function emitPref() {
  if (hayVentana()) dispatchEvent(new Event("ly-pref"));
}

/** Suscripción única para las tres preferencias (evento propio + otras pestañas). */
export function subscribePref(cb: () => void) {
  if (!hayVentana()) return () => {};
  const h = () => cb();
  addEventListener("ly-pref", h);
  addEventListener("storage", h); // sincroniza entre pestañas
  return () => {
    removeEventListener("ly-pref", h);
    removeEventListener("storage", h);
  };
}

/** Modo claro/oscuro. Cadena: la identidad es el propio valor, no hace falta caché. */
export function themeSnap(): "dark" | "light" {
  if (!hayVentana()) return "dark";
  const t = localStorage.getItem(CLAVE_MODO);
  if (t === "dark" || t === "light") return t;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function mutedSnap(): boolean {
  return hayVentana() && localStorage.getItem(CLAVE_SILENCIO) === "1";
}

// ── Tema (objeto): cacheado por el texto crudo ──────────────────────────────
let cache: { crudo: string; valor: Tema } | null = null;

/** `getSnapshot` del tema. Devuelve la MISMA referencia mientras no cambie nada. */
export function temaSnap(): Tema {
  if (!hayVentana()) return TEMA_DEFECTO;
  const crudo = localStorage.getItem(CLAVE_TEMA) ?? "";
  if (cache && cache.crudo === crudo) return cache.valor;
  let valor: Tema;
  try {
    valor = normalizarTema(JSON.parse(crudo || "null"));
  } catch {
    valor = TEMA_DEFECTO; // JSON roto en localStorage: se usa el de fábrica
  }
  cache = { crudo, valor };
  return valor;
}

export function guardarTema(t: Tema) {
  if (!hayVentana()) return;
  try { localStorage.setItem(CLAVE_TEMA, JSON.stringify(t)); } catch {}
  emitPref();
}

export function guardarModo(m: "dark" | "light") {
  if (!hayVentana()) return;
  try { localStorage.setItem(CLAVE_MODO, m); } catch {}
  emitPref();
}

export function guardarSilencio(silenciado: boolean) {
  if (!hayVentana()) return;
  try { localStorage.setItem(CLAVE_SILENCIO, silenciado ? "1" : "0"); } catch {}
  emitPref();
}

/** Sólo para pruebas: olvida la caché para empezar de cero. */
export function olvidarCache() {
  cache = null;
}
