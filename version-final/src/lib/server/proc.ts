// Lanzar un proceso «y olvidarse» (taskkill, shutdown, explorer…).
//
// Un `spawn` que falla NO lanza excepción: emite el evento `error` en el hijo.
// Si nadie lo escucha, Node lo considera un error no capturado y **mata el
// servidor entero**. Con `taskkill` o `shutdown` ausentes (o bloqueados por
// antivirus), eso significaba que apagar el equipo al terminar la cola dejaba
// la app muerta sin explicación. Aquí siempre hay listener.
import { spawn } from "node:child_process";

export function lanzarSuelto(
  cmd: string,
  args: string[],
  opts: { detached?: boolean } = {},
): void {
  try {
    const p = spawn(cmd, args, {
      shell: false,
      detached: opts.detached ?? false,
      stdio: "ignore",
      windowsHide: true,
    });
    p.on("error", () => { /* no hay nada que hacer: era un extra opcional */ });
    if (opts.detached) p.unref();
  } catch { /* spawn síncrono rara vez falla; si falla, tampoco pasa nada */ }
}
