// «¿Dónde está de verdad este archivo?»
//
// El historial guarda la ruta que se creyó al terminar la descarga. Con el
// tiempo esa ruta puede quedarse desfasada (otra carpeta de salida, el motor
// sanitizó el nombre de otra manera, el post-proceso cambió la extensión…).
// Antes se comprobaba con un simple `existsSync`: si fallaba, la tarjeta decía
// «El archivo ya no está en esa ruta» aunque el archivo estuviera ahí al lado.
//
// Aquí se busca de verdad: primero la ruta exacta, luego la carpeta del propio
// archivo y, si hace falta, un índice de la carpeta de salida con caché corta
// (para no recorrer el disco en cada petición).
import fs from "node:fs";
import path from "node:path";
import { mejorCandidato, type Motivo, type Pista } from "../shared/parecido";

const TTL_MS = 20_000;
const MAX_ARCHIVOS = 20_000;
const MAX_PROFUNDIDAD = 4;

interface Indice { archivos: { ruta: string; mtime: number }[]; ts: number }
const indices = new Map<string, Indice>();

/** Extensiones temporales que el motor deja mientras descarga. */
const TEMPORALES = /\.(part|part-frag\d*|ytdl|temp|tmp|download|crdownload)$/i;

/** Vuelve a leer el disco la próxima vez (tras terminar una descarga). */
export function invalidarIndice(dir?: string): void {
  if (dir) indices.delete(path.resolve(dir));
  else indices.clear();
}

function listarCarpeta(dir: string, salida: { ruta: string; mtime: number }[], prof: number): void {
  if (prof > MAX_PROFUNDIDAD || salida.length >= MAX_ARCHIVOS) return;
  let entradas: fs.Dirent[];
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    if (salida.length >= MAX_ARCHIVOS) return;
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { listarCarpeta(p, salida, prof + 1); continue; }
    if (TEMPORALES.test(e.name)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
    salida.push({ ruta: p, mtime });
  }
}

/** Índice (con caché de 20 s) de los archivos de una carpeta y sus subcarpetas. */
export function indiceDe(dir: string): { ruta: string; mtime: number }[] {
  const clave = path.resolve(dir);
  const ahora = Date.now();
  const guardado = indices.get(clave);
  if (guardado && ahora - guardado.ts < TTL_MS) return guardado.archivos;
  const archivos: { ruta: string; mtime: number }[] = [];
  listarCarpeta(clave, archivos, 0);
  indices.set(clave, { archivos, ts: ahora });
  return archivos;
}

export interface Resuelta {
  ruta: string;
  motivo: Motivo;
  /** true si la ruta encontrada NO es la guardada (el historial estaba mal). */
  corregida: boolean;
}

/**
 * Encuentra el archivo real de una entrada del historial.
 * @returns la ruta buena o `null` si de verdad no aparece por ningún lado.
 */
export function resolverRutaReal(pista: Pista, outputDir: string): Resuelta | null {
  // 1. La ruta guardada, tal cual.
  try {
    if (fs.statSync(pista.path).isFile()) return { ruta: pista.path, motivo: "exacta", corregida: false };
  } catch { /* sigue abajo */ }

  // 2. Su propia carpeta (barato: casi siempre está ahí al lado).
  const carpeta = path.dirname(pista.path);
  let hermanos: { ruta: string; mtime: number }[] = [];
  try {
    const entradas0 = fs.readdirSync(carpeta, { withFileTypes: true });
    // Si esa carpeta tiene miles de archivos, esto se salta: el índice general
    // (que ya está cacheado) lo resuelve sin castigar cada petición.
    if (entradas0.length > 400) throw new Error("carpeta demasiado grande");
    hermanos = entradas0
      .filter((e) => e.isFile() && !TEMPORALES.test(e.name))
      .map((e) => {
        const ruta = path.join(carpeta, e.name);
        let mtime = 0;
        try { mtime = fs.statSync(ruta).mtimeMs; } catch {}
        return { ruta, mtime };
      });
  } catch { /* la carpeta tampoco existe */ }
  const enSuCarpeta = mejorCandidato(hermanos, pista, (r) => hermanos.find((x) => x.ruta === r)?.mtime ?? 0);
  if (enSuCarpeta) return { ruta: enSuCarpeta.ruta, motivo: enSuCarpeta.motivo, corregida: true };

  // 3. Toda la carpeta de salida (otra subcarpeta, otra carpeta de descargas…).
  if (outputDir) {
    const indice = indiceDe(outputDir).slice();
    // La carpeta del archivo, si existe, también entra (por si la salida
    // configurada ya no es la de antes).
    if (path.resolve(carpeta) !== path.resolve(outputDir)) {
      try {
        for (const e of fs.readdirSync(carpeta, { withFileTypes: true })) {
          if (e.isFile() && !TEMPORALES.test(e.name)) {
            const ruta = path.join(carpeta, e.name);
            let mtime = 0;
            try { mtime = fs.statSync(ruta).mtimeMs; } catch {}
            indice.push({ ruta, mtime });
          }
        }
      } catch { /* nada */ }
    }
    const enSalida = mejorCandidato(indice, pista, (r) => indice.find((x) => x.ruta === r)?.mtime ?? 0);
    if (enSalida) return { ruta: enSalida.ruta, motivo: enSalida.motivo, corregida: true };
  }
  return null;
}

/**
 * Carpeta más cercana que SÍ existe (para abrir algo en vez de nada).
 * `C:\a\b\c\v.mp4` con `C:\a` existente → `C:\a`.
 */
export function primerAncestroExistente(ruta: string): string | null {
  let actual = path.resolve(ruta);
  for (let i = 0; i < 40; i++) {
    const padre = path.dirname(actual);
    if (padre === actual) return null;
    actual = padre;
    try {
      if (fs.statSync(actual).isDirectory()) {
        // Abrir «C:\» o «/» no ayuda a nadie: se considera que no hay nada
        // cercano que enseñar y se explica el problema en su lugar.
        const raiz = path.parse(actual).root;
        if (raiz === actual) return null;
        return actual;
      }
    } catch { /* sigue subiendo */ }
  }
  return null;
}
