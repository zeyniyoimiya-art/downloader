// Abrir una carpeta (o seleccionar un archivo) en el explorador del sistema.
//
// ── LOS FALLOS REALES QUE ARREGLA ESTE ARCHIVO ──────────────────────────────
// 1. `spawn("explorer", ["/select,", ruta])` — DOS argumentos. Explorer recibía
//    `/select,` suelto y abría Documentos.
// 2. `spawn("explorer", ["/select," + ruta])` con una ruta que tiene espacios
//    («Madonna Vs Sickick - Frozen.m4a») TAMPOCO: Node entrecomilla el
//    argumento entero → `"/select,C:\…\a b.mp4"`, y Explorer solo acepta las
//    comillas alrededor de la RUTA. No abre nada y no da error.
//    Correcto: `['/select,"C:\…\a b.mp4"']` + `windowsVerbatimArguments: true`.
// 3. Un `spawn` que falla emite `error` en el hijo; sin listener, **se cae el
//    servidor**. Aquí siempre se escucha.
// 4. Un `spawn` correcto puede quedarse en nada si Explorer está raro: por eso
//    hay TRES métodos en Windows y el resultado dice cuál funcionó.
//
// Explorer devuelve código 1 aunque todo vaya bien: se espera el evento
// `spawn` (que sí dice si el sistema aceptó crear el proceso), nunca el código
// de salida.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { primerAncestroExistente } from "./rutas";

export type Plataforma = "win32" | "darwin" | "linux";

export interface Comando {
  cmd: string;
  args: string[];
  /** Nombre corto del método, para poder contarlo en la respuesta. */
  metodo: string;
  /** Opciones de `spawn` que dependen de la plataforma. */
  opciones: { windowsVerbatimArguments?: boolean };
}

/** Quita la barra final para no romper el entrecomillado (`"C:\` se escapa). */
function sinBarraFinal(p: string): string {
  return p.length > 3 ? p.replace(/[\\/]+$/, "") : p;
}

/** Qué comando y argumentos se usan. Puro: se puede probar en cualquier SO. */
export function comandoPara(plat: Plataforma, destino: string, seleccionar: boolean): Comando {
  return metodos(plat, destino, seleccionar)[0];
}

/** Todos los métodos disponibles, en orden de preferencia. */
export function metodos(plat: Plataforma, destino: string, seleccionar: boolean): Comando[] {
  const ruta = sinBarraFinal(destino);
  if (plat === "win32") {
    const arg = seleccionar ? `/select,"${ruta}"` : `"${ruta}"`;
    return [
      // 1. El directo. Con verbatim, Node NO re-escapa las comillas internas.
      { cmd: "explorer.exe", args: [arg], metodo: "explorer", opciones: { windowsVerbatimArguments: true } },
      // 2. Por `start`, que delega en ShellExecute y perdona más rarezas.
      { cmd: "cmd.exe", args: ["/c", "start", "", "explorer.exe", arg], metodo: "cmd-start", opciones: { windowsVerbatimArguments: true } },
      // 3. PowerShell + Start-Process: otro camino distinto al mismo sitio.
      {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath explorer.exe -ArgumentList '${arg}'`],
        metodo: "powershell",
        opciones: { windowsVerbatimArguments: true },
      },
    ];
  }
  if (plat === "darwin") {
    return [{ cmd: "open", args: seleccionar ? ["-R", ruta] : [ruta], metodo: "open", opciones: {} }];
  }
  return [{ cmd: "xdg-open", args: [seleccionar ? path.dirname(ruta) : ruta], metodo: "xdg-open", opciones: {} }];
}

/** Plan B en Windows (compatibilidad con llamadas antiguas). */
export function comandoAlterno(plat: Plataforma, destino: string, seleccionar: boolean): Comando | null {
  if (plat !== "win32") return null;
  return metodos(plat, destino, seleccionar)[1] ?? null;
}

export interface ResultadoAbrir {
  ok: boolean;
  /** Ruta que se mandó abrir (útil para enseñarla en la UI). */
  destino?: string;
  /** Aviso en español cuando no se pudo hacer lo ideal pero sí algo. */
  aviso?: string;
  /** Qué se ejecutó, para poder diagnosticar sin adivinar. */
  comando?: string;
  /** Método que arrancó: explorer | cmd-start | powershell | open | xdg-open */
  metodo?: string;
  error?: string;
}

/** Lanza un proceso y espera solo a saber si ARRANCÓ (evento `spawn`). */
function lanzar(c: Comando): Promise<string | null> {
  return new Promise((resolve) => {
    let resuelto = false;
    const fin = (v: string | null) => { if (!resuelto) { resuelto = true; resolve(v); } };
    try {
      const hijo = spawn(c.cmd, c.args, {
        shell: false,
        stdio: "ignore",
        ...c.opciones,
      });
      hijo.on("spawn", () => { hijo.unref(); fin(null); });
      hijo.on("error", (e) => fin(e.message));
      // Red de seguridad: no se puede dejar la petición colgada.
      setTimeout(() => { hijo.unref(); fin(null); }, 3000);
    } catch (e) {
      fin(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * Abre `destino` en el gestor de archivos. Si `seleccionar` y es un archivo, se
 * selecciona; si no, se abre la carpeta que lo contiene. Si no existe nada de
 * la ruta, abre la carpeta más cercana que sí exista (nunca «no pasa nada»).
 * Nunca lanza.
 */
export async function abrirEnSistema(destino: string, seleccionar = false): Promise<ResultadoAbrir> {
  let esArchivo = false;
  let existe = false;
  try {
    const st = fs.statSync(destino);
    existe = true;
    esArchivo = st.isFile();
  } catch { /* no existe: se busca más arriba */ }

  let objetivo = destino;
  let aviso: string | undefined;
  if (!existe) {
    const carpeta = path.dirname(destino);
    if (fs.existsSync(carpeta)) {
      objetivo = carpeta;
      aviso = "El archivo ya no está en esa ruta; se abrió su carpeta.";
    } else {
      const ancestro = primerAncestroExistente(destino);
      if (!ancestro) {
        return { ok: false, error: "Esa ruta no existe y no hay ninguna carpeta cercana que abrir. ¿Cambió la carpeta de salida?" };
      }
      objetivo = ancestro;
      aviso = `Esa ruta ya no existe; se abrió la carpeta más cercana que sí está: ${ancestro}`;
    }
  } else if (seleccionar && !esArchivo) {
    aviso = "Eso es una carpeta: se abrió tal cual.";
  }

  const plat = process.platform as Plataforma;
  const quiereSeleccionar = seleccionar && esArchivo;
  const lista = metodos(plat, objetivo, quiereSeleccionar);
  let ultimo = "";
  for (const c of lista) {
    const texto = `${c.cmd} ${c.args.join(" ")}`;
    const fallo = await lanzar(c);
    if (!fallo) return { ok: true, destino: objetivo, aviso, comando: texto, metodo: c.metodo };
    ultimo = fallo;
  }
  return {
    ok: false,
    error: `El sistema no dejó abrir el explorador (${ultimo || "sin respuesta"}). Abre esta ruta a mano: ${objetivo}`,
    comando: lista.map((c) => `${c.cmd} ${c.args.join(" ")}`).join("  |  "),
  };
}
