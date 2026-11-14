// Abrir una carpeta (o seleccionar un archivo) en el explorador del sistema.
//
// ── LOS DOS FALLOS QUE ARREGLA ESTO ─────────────────────────────────────────
// 1. `spawn("explorer", ["/select,", ruta])` — dos argumentos. Explorer recibe
//    `/select,` suelto y la ruta aparte, no entiende la orden y se abre donde
//    le parece (normalmente Documentos). Era exactamente el «le doy a la
//    ubicación del archivo y me manda a otra carpeta». Va como UN solo
//    argumento: `"/select,C:\ruta\archivo.mp3"`.
// 2. Un `spawn` que falla (binario que no está, permisos) NO lanza una
//    excepción: emite el evento `error` en el hijo, y si nadie lo escucha el
//    proceso de Node se cae entero. Aquí siempre hay un `on("error")`.
//
// Explorer, además, devuelve código 1 aunque todo vaya bien: nunca se mira el
// código de salida para decidir si funcionó.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type Plataforma = "win32" | "darwin" | "linux";

/** Qué comando y argumentos se usan. Puro: se puede probar en cualquier SO. */
export function comandoPara(plat: Plataforma, destino: string, seleccionar: boolean): { cmd: string; args: string[] } {
  if (plat === "win32") {
    // Un solo argumento. Con espacios, Node lo entrecomilla entero y Explorer
    // lo entiende: "/select,C:\Users\Yo\Mis descargas\video.mp4".
    return { cmd: "explorer.exe", args: seleccionar ? [`/select,${destino}`] : [destino] };
  }
  if (plat === "darwin") return { cmd: "open", args: seleccionar ? ["-R", destino] : [destino] };
  // Linux: xdg-open no sabe seleccionar; se abre la carpeta que lo contiene.
  return { cmd: "xdg-open", args: [seleccionar ? path.dirname(destino) : destino] };
}

export interface ResultadoAbrir {
  ok: boolean;
  /** Ruta que se mandó abrir (útil para enseñarla en la UI). */
  destino?: string;
  /** Aviso en español cuando no se pudo hacer lo ideal pero sí algo. */
  aviso?: string;
  error?: string;
}

/**
 * Abre `destino` en el gestor de archivos. Si `seleccionar` y es un archivo, se
 * selecciona; si no, se abre la carpeta que lo contiene.
 * Nunca lanza: devuelve `{ ok:false, error }` con una frase entendible.
 */
export function abrirEnSistema(destino: string, seleccionar = false): ResultadoAbrir {
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

  const { cmd, args } = comandoPara(process.platform as Plataforma, objetivo, seleccionar && esArchivo);
  try {
    const hijo = spawn(cmd, args, { shell: false, detached: true, stdio: "ignore", windowsHide: true });
    // Sin este listener, un ENOENT (p. ej. un Linux sin xdg-open) tumba el
    // servidor en vez de devolver un error.
    hijo.on("error", () => { /* se ignora: el objetivo era soltar la orden */ });
    hijo.unref();
    return { ok: true, destino: objetivo, aviso };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ENOENT con xdg-open/open: el sistema no tiene gestor de archivos.
    return { ok: false, error: `No se pudo abrir el explorador (${msg}). Abre esta ruta a mano: ${objetivo}` };
  }
}
