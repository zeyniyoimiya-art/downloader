// Avisos del sistema (el «toast» de Windows) y apagado al terminar.
//
// ── POR QUÉ NO UNA LIBRERÍA ─────────────────────────────────────────────────
// La app es local y se sirve en 127.0.0.1, así que la Notification API del
// navegador ya produce un aviso NATIVO del sistema operativo (Windows lo pinta
// en el centro de notificaciones). Añadir una dependencia para eso sería absurdo.
//
// El permiso SOLO se puede pedir dentro de un gesto del usuario (un clic): si se
// pide al cargar la página, Chrome y Edge lo ignoran o lo bloquean para siempre.

export type PermisoAvisos = "default" | "granted" | "denied" | "no-soportado";

// ── Mini-store del permiso ──────────────────────────────────────────────────
// Se expone como store externo para leerlo con `useSyncExternalStore`: así React
// usa el valor del servidor ("default") durante la hidratación y el real justo
// después, sin el desajuste de hidratación que daría leerlo en el render.
let cachePermiso: PermisoAvisos | null = null;
const oyentes = new Set<() => void>();

export function suscribirPermiso(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}

/** Foto estable del permiso (misma referencia mientras no cambie). */
export function leerPermiso(): PermisoAvisos {
  if (!cachePermiso) cachePermiso = estadoPermiso();
  return cachePermiso;
}

/** Fuerza volver a leer `Notification.permission` y avisar a los suscriptores. */
export function refrescarPermiso(): void {
  cachePermiso = null;
  for (const cb of oyentes) cb();
}

export function estadoPermiso(): PermisoAvisos {
  if (typeof window === "undefined" || !("Notification" in window)) return "no-soportado";
  return Notification.permission as PermisoAvisos;
}

/** Pide permiso. Devuelve el estado resultante (llamalo desde un onClick). */
export async function pedirPermiso(): Promise<PermisoAvisos> {
  if (typeof window === "undefined" || !("Notification" in window)) return "no-soportado";
  try {
    return (await Notification.requestPermission()) as PermisoAvisos;
  } catch {
    return "denied";
  }
}

/**
 * Muestra un aviso. Nunca lanza: si el navegador lo bloquea o el usuario dijo
 * que no, se ignora en silencio (el toast interno de la app sigue funcionando).
 */
export function avisar(titulo: string, cuerpo?: string): boolean {
  try {
    if (estadoPermiso() !== "granted") return false;
    // `tag` hace que dos avisos de la misma descarga se sustituyan en vez de
    // apilarse; `silent` no: sonido sí, es el único aviso que hay.
    const n = new Notification(titulo, { body: cuerpo, tag: "linyue", icon: "/icon.svg" });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 8000);
    return true;
  } catch {
    return false;
  }
}
