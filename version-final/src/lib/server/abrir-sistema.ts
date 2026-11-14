// Abrir una carpeta (o seleccionar un archivo) en el explorador del sistema.
//
// ── TRES FALLOS REALES QUE ARREGLA ESTE ARCHIVO ─────────────────────────────
// 1. `spawn("explorer", ["/select,", ruta])` — DOS argumentos. Explorer recibía
//    `/select,` suelto y abría Documentos. («Le doy a la ubicación y me manda a
//    otra carpeta».)
// 2. `spawn("explorer", ["/select," + ruta])` con UNA ruta que tiene espacios
//    («Madonna Vs Sickick - Frozen.m4a») TAMPOCO funciona: Node entrecomilla el
//    argumento entero → `"/select,C:\…\Madonna Vs Sickick - Frozen.m4a"` — y
//    Explorer solo acepta las comillas alrededor de la RUTA, no del conjunto.
//    Resultado: no se abre nada (o se abre Documentos), sin ningún error.
//    La forma correcta es pasar el argumento ya montado y sin que Node lo
//    re-escape:
//        spawn("explorer", ['/select,"C:\\ruta con espacios\\video.mp4"'],
//              { windowsVerbatimArguments: true })
//    `windowsVerbatimArguments` es imprescindible: sin él, Node escapa las
//    comillas internas (`\"`) y vuelve a romperlo.
// 3. Un `spawn` que falla emite el evento `error` en el hijo; si nadie lo
//    escucha, **se cae el servidor entero**. Aquí siempre se escucha, y hay un
//    segundo intento por `cmd /c start` por si el primero no arranca.
//
// Explorer devuelve código 1 aunque todo vaya bien: nunca se mira el código de
// salida para decidir si funcionó (se mira el evento `spawn`, que sí es fiable).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Plataforma = "win32" | "darwin" | "linux";

export interface Comando {
  cmd: string;
  args: string[];
  /** Opciones de `spawn` que dependen de la plataforma. */
  opciones: { windowsVerbatimArguments?: boolean };
}

/** Quita la barra final para no romper el entrecomillado (`"C:\` se escapa). */
function sinBarraFinal(p: string): string {
  return p.length > 3 ? p.replace(/[\\/]+$/, "") : p;
}

/** Qué comando y argumentos se usan. Puro: se puede probar en cualquier SO. */
export function comandoPara(plat: Plataforma, destino: string, seleccionar: boolean): Comando {
  const ruta = sinBarraFinal(destino);
  if (plat === "win32") {
    if (seleccionar) {
      // Las comillas van DENTRO del argumento, alrededor de la ruta.
      return { cmd: "explorer.exe", args: [`/select,"${ruta}"`], opciones: { windowsVerbatimArguments: true } };
    }
    // Abrir la carpeta sí tolera espacios sin trucos, pero se entrecomilla
    // igual por coherencia (verbatim + comillas explícitas).
    return { cmd: "explorer.exe", args: [`"${ruta}"`], opciones: { windowsVerbatimArguments: true } };
  }
  if (plat === "darwin") return { cmd: "open", args: seleccionar ? ["-R", ruta] : [ruta], opciones: {} };
  // Linux: xdg-open no sabe seleccionar; se abre la carpeta que lo contiene.
  return { cmd: "xdg-open", args: [seleccionar ? path.dirname(ruta) : ruta], opciones: {} };
}

/** Plan B en Windows: `start` delega en ShellExecute y perdona más rarezas. */
export function comandoAlterno(plat: Plataforma, destino: string, seleccionar: boolean): Comando | null {
  if (plat !== "win32") return null;
  const ruta = sinBarraFinal(destino);
  return {
    cmd: "cmd.exe",
    args: ["/c", "start", "", "explorer.exe", seleccionar ? `/select,"${ruta}"` : `"${ruta}"`],
    opciones: { windowsVerbatimArguments: true },
  };
}

export interface ResultadoAbrir {
  ok: boolean;
  /** Ruta que se mandó abrir (útil para enseñarla en la UI). */
  destino?: string;
  /** Aviso en español cuando no se pudo hacer lo ideal pero sí algo. */
  aviso?: string;
  /** Qué se ejecutó, para poder diagnosticar sin adivinar. */
  comando?: string;
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
      // `spawn` se emite cuando el SO aceptó crear el proceso: es la única
      // señal fiable (explorer.exe siempre termina con código 1).
      hijo.on("spawn", () => { hijo.unref(); fin(null); });
      hijo.on("error", (e) => fin(e.message));
      // Red de seguridad: si no llega ninguno de los dos en 3 s, se da por hecho
      // (no se puede dejar la petición colgada).
      setTimeout(() => { hijo.unref(); fin(null); }, 3000);
    } catch (e) {
      fin(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * Abre `destino` en el gestor de archivos. Si `seleccionar` y es un archivo, se
 * selecciona; si no, se abre la carpeta que lo contiene.
 * Nunca lanza: devuelve `{ ok:false, error }` con una frase entendible.
 */
export async function abrirEnSistema(destino: string, seleccionar = false): Promise<ResultadoAbrir> {
  let esArchivo = false;
  let existe = false;
  try {
    const st = fs.statSync(destino);
    existe = true;
    esArchivo = st.isFile();
  } catch { /* no existe: se intenta con la carpeta de arriba */ }

  let objetivo = destino;
  let aviso: string | undefined;
  if (!existe) {
    const carpeta = path.dirname(destino);
    if (fs.existsSync(carpeta)) {
      objetivo = carpeta;
      aviso = "El archivo ya no está en esa ruta; se abrió su carpeta.";
    } else {
      return { ok: false, error: "Ni el archivo ni su carpeta existen. Puede que lo hayas movido o borrado." };
    }
  } else if (seleccionar && !esArchivo) {
    aviso = "Eso es una carpeta: se abrió tal cual.";
  }

  const plat = process.platform as Plataforma;
  const quiereSeleccionar = seleccionar && esArchivo;
  const primero = comandoPara(plat, objetivo, quiereSeleccionar);
  const texto = `${primero.cmd} ${primero.args.join(" ")}`;

  const fallo1 = await lanzar(primero);
  if (!fallo1) return { ok: true, destino: objetivo, aviso, comando: texto };

  // Segundo intento (Windows): `cmd /c start`.
  const planB = comandoAlterno(plat, objetivo, quiereSeleccionar);
  if (planB) {
    const fallo2 = await lanzar(planB);
    if (!fallo2) return { ok: true, destino: objetivo, aviso, comando: `${planB.cmd} ${planB.args.join(" ")}` };
    return {
      ok: false,
      error: `El sistema no dejó abrir el explorador (${fallo2}). Abre esta ruta a mano: ${objetivo}`,
      comando: texto,
    };
  }
  return {
    ok: false,
    error: `No se pudo abrir el explorador (${fallo1}). Abre esta ruta a mano: ${objetivo}`,
    comando: texto,
  };
}
