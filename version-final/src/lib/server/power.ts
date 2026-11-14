// Apagar el equipo cuando la cola termina («déjalo bajando y me voy a dormir»).
//
// ── REGLAS DE SEGURIDAD ─────────────────────────────────────────────────────
// Esto apaga un ordenador de verdad, así que:
//  · Nunca se ejecuta solo: hay que activarlo en Ajustes Y debe haber habido al
//    menos UNA descarga terminada en esta sesión (si arrancas la app con la cola
//    vacía, no se apaga nada).
//  · Siempre con cuenta atrás (60 s por defecto) y un botón para cancelar.
//  · `spawn` con argumentos en array, sin shell: no hay texto de usuario aquí.
//  · Si el sistema no lo soporta, se dice; no se finge que funcionó.
import { lanzarSuelto } from "./proc";

let apagadoEn: number | null = null;
let ultimoDetalle = "";

export const soportado = () => process.platform === "win32" || process.platform === "linux";

export interface EstadoApagado {
  /** Instante (ms) del apagado programado, o null. */
  en: number | null;
  soportado: boolean;
  detalle: string;
}

export function estadoApagado(): EstadoApagado {
  return { en: apagadoEn, soportado: soportado(), detalle: ultimoDetalle };
}

/**
 * Programa el apagado. En Windows usa `shutdown /t` (cancelable con `/a`); en
 * Linux usa `shutdown +N`, que solo funciona si el usuario puede apagar el
 * equipo (grupo sudo / polkit). Si falla, el error se devuelve tal cual.
 */
export function programarApagado(segundos = 60): { ok: boolean; error?: string; en?: number } {
  if (apagadoEn) return { ok: true, en: apagadoEn };
  if (!soportado()) return { ok: false, error: "El apagado automático solo está soportado en Windows y Linux." };
  const seg = Math.max(15, Math.min(3600, Math.round(segundos)));
  try {
    if (process.platform === "win32") {
      lanzarSuelto("shutdown", ["/s", "/t", String(seg), "/c", "Linyue: la cola de descargas ha terminado."], { detached: true });
    } else {
      lanzarSuelto("shutdown", ["-h", `+${Math.max(1, Math.ceil(seg / 60))}`], { detached: true });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo programar el apagado" };
  }
  apagadoEn = Date.now() + seg * 1000;
  ultimoDetalle = `apagado en ${seg} s`;
  return { ok: true, en: apagadoEn };
}

/** Cancela el apagado pendiente (`shutdown /a` en Windows, `shutdown -c` en Linux). */
export function cancelarApagado(): { ok: boolean; error?: string } {
  if (!apagadoEn) return { ok: true };
  try {
    if (process.platform === "win32") lanzarSuelto("shutdown", ["/a"], { detached: true });
    else lanzarSuelto("shutdown", ["-c"], { detached: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo cancelar" };
  }
  apagadoEn = null;
  ultimoDetalle = "cancelado";
  return { ok: true };
}

/** Solo para los tests: deja el estado como recién arrancado. */
export function _resetApagado(): void {
  apagadoEn = null;
  ultimoDetalle = "";
}
