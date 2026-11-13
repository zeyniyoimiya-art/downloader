// 蓝奏云 (Lanzou) — extractor NATIVO, sin binario externo.
//
// ── POR QUÉ UN EXTRACTOR PROPIO ─────────────────────────────────────────────
// Lanzou es el "MediaFire chino": lo usan miles de subidas de APKs, juegos y
// mods. No pide cuenta (a diferencia de 百度网盘), pero tampoco da un enlace
// directo: hay una cadena de tres saltos con un `sign` y un POST con `Referer`.
// yt-dlp no lo soporta y gallery-dl tampoco, así que aquí lo hacemos nosotros
// con `fetch`. Es el sitio perfecto para un extractor nativo.
//
// ── LA CADENA (y por qué se rompe) ──────────────────────────────────────────
//   1. GET página del recurso          → sale un <iframe> (o un JS con la URL)
//   2. GET del iframe                  → sale `sign` + `ajaxm.php?file=…`
//   3. POST ajaxm.php (action=downprocess&sign=…)
//                                      → JSON {zt:1, dom:"…", url:"/file/…"}
//   4. GET dom+url con Referer del iframe → el archivo
//
// Lanzou cambia el HTML cada pocos meses. Por eso: varios patrones por paso,
// errores explícitos ("cambió el formato") en vez de un timeout mudo, y **toda
// la lógica de parseo aparte** para poder testearla sin red.
//
// Nunca se guardan cookies ni credenciales: Lanzou no tiene cuentas aquí.

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Dominios de Lanzou (van rotando: lanzoui, lanzoux, lanzoub…). */
const HOSTS = /(^|\.)(lanzou[a-z]?|lanzn|lanzt|lanza|lanzy|lanzi)\.(com|cn|net)$/i;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function esLanzou(url: string): boolean {
  try { return HOSTS.test(new URL(url).hostname); } catch { return false; }
}

export interface LanzouResuelto {
  /** URL directa del archivo (derecho de descarga). */
  url: string;
  /** Nombre sugerido (del JSON de Lanzou o de la URL). */
  nombre: string;
  /** Referer que EXIGE la descarga (sin él: 403). */
  referer: string;
}

/** 1) El <iframe> donde vive el botón de descarga. */
export function extraerIframe(html: string): string | null {
  // <iframe class="n_downlink" src="/fn?xxxx" scrolling="no"></iframe>
  const m = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
  return m ? m[1] : null;
}

/** 2) Del iframe salen el `sign` y el endpoint `ajaxm.php?file=…`. */
export function extraerFirma(html: string): { sign: string; file: string; p?: string } | null {
  // data : {'action':'downprocess','sign':'xxxx','ves':1,'websign':'','websignkey':'','p':''},
  const sign = html.match(/['"]?sign['"]?\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    ?? html.match(/ajaxm\.php\?file=([^&"']+).*?sign=([a-zA-Z0-9]+)/i)?.[2]
    ?? null;
  const file = html.match(/ajaxm\.php\?file=([^&"']+)/i)?.[1]
    ?? html.match(/['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    ?? null;
  if (!sign || !file) return null;
  const p = html.match(/['"]?p['"]?\s*:\s*['"]([^'"]*)['"]/i)?.[1];
  return { sign, file, p: p || undefined };
}

/** 3) La respuesta de ajaxm.php. `dom` puede venir sin esquema. */
export function interpretarAjaxm(json: string, base: string): { url: string; nombre?: string } | null {
  let d: Record<string, unknown>;
  try { d = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  if (String(d.zt ?? "") !== "1") return null;
  const dom = String(d.dom ?? "").replace(/\\\//g, "/").trim();
  const rel = String(d.url ?? "").replace(/\\\//g, "/").trim();
  if (!rel) return null;
  const origen = dom
    ? (/^https?:/i.test(dom) ? dom : "https://" + dom)
    : new URL(base).origin;
  return { url: new URL(rel, origen + "/").toString(), nombre: typeof d.inf === "string" ? d.inf : undefined };
}

function cabeceras(referer?: string): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,es;q=0.8,en;q=0.7",
    ...(referer ? { Referer: referer } : {}),
  };
}

/**
 * Resuelve la cadena completa y devuelve la URL directa.
 * @param url  enlace del recurso (con o sin `?pwd=`)
 * @param pwd  contraseña si la página la pide aparte
 */
export async function resolverLanzou(url: string, pwd?: string, timeoutMs = 30000): Promise<LanzouResuelto> {
  const señal = AbortSignal.timeout(timeoutMs);
  const pedir = async (u: string, init: RequestInit = {}) => {
    const r = await fetch(u, { ...init, headers: { ...cabeceras(init.headers && (init.headers as Record<string, string>).Referer ? (init.headers as Record<string, string>).Referer : undefined), ...(init.headers as Record<string, string> | undefined) }, signal: señal, redirect: "follow" });
    if (!r.ok) throw new Error(`Lanzou respondió ${r.status} en ${new URL(u).pathname}`);
    return r;
  };

  // Paso 1: página del recurso
  let html = await (await pedir(url)).text();

  // ¿Pide contraseña? (formulario con name="pwd" y sin iframe todavía)
  const pideClave = /name=["']pwd["']/i.test(html) && !extraerIframe(html);
  if (pideClave) {
    if (!pwd) throw new Error("Este recurso de Lanzou pide contraseña: pega el enlace con «?pwd=clave» o añade «密码: clave».");
    const cuerpo = new URLSearchParams({ pwd });
    html = await (await pedir(url, { method: "POST", body: cuerpo, headers: { "Content-Type": "application/x-www-form-urlencoded" } })).text();
  }

  // Paso 2: el iframe
  let iframe = extraerIframe(html);
  if (!iframe) throw new Error("Lanzou cambió el formato: no encuentro el iframe de descarga (¿el recurso fue borrado?).");
  if (!/^https?:/i.test(iframe)) iframe = new URL(iframe, url).toString();
  const htmlIframe = await (await pedir(iframe)).text();

  // Paso 3: firma + ajaxm.php
  const firma = extraerFirma(htmlIframe);
  if (!firma) throw new Error("Lanzou cambió el formato: no encuentro el «sign» de descarga.");
  const ajax = new URL(`/ajaxm.php?file=${encodeURIComponent(firma.file)}`, iframe).toString();
  const cuerpo = new URLSearchParams({ action: "downprocess", sign: firma.sign, ves: "1", websign: "", websignkey: "", ...(firma.p ? { p: firma.p } : {}) });
  const json = await (await pedir(ajax, { method: "POST", body: cuerpo, headers: { "Content-Type": "application/x-www-form-urlencoded" } })).text();
  const final = interpretarAjaxm(json, ajax);
  if (!final) {
    // zt !== 1 casi siempre es "necesita contraseña" o "recurso caducado".
    throw new Error("Lanzou no devolvió enlace directo (recurso caducado o contraseña incorrecta).");
  }

  const nombre = final.nombre
    ?? decodeURIComponent(new URL(final.url).pathname.split("/").pop() || "")
    ?? "";
  return { url: final.url, nombre: nombre || "archivo", referer: iframe };
}

/**
 * Descarga la URL directa a disco con progreso.
 * Lanzou manda un `Content-Disposition` con el nombre real, así que se usa ese
 * si existe (el de la URL a veces es `file/?` sin nombre).
 */
export async function descargarLanzou(
  resuelto: LanzouResuelto,
  destino: string,
  onProgreso?: (pct: number, bytes: number) => void,
): Promise<string> {
  const r = await fetch(resuelto.url, { headers: cabeceras(resuelto.referer), redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`Lanzou rechazó la descarga (${r.status}). Suele ser el Referer: reintenta.`);
  const total = Number(r.headers.get("content-length") ?? 0);
  let leidos = 0;
  const cuerpo = r.body as unknown as ReadableStream<Uint8Array>;
  const nodo = Readable.fromWeb(cuerpo as Parameters<typeof Readable.fromWeb>[0]);
  nodo.on("data", (trozo: Buffer) => {
    leidos += trozo.length;
    if (onProgreso) onProgreso(total ? Math.min(99, Math.round((leidos / total) * 100)) : 0, leidos);
  });
  await pipeline(nodo, createWriteStream(destino));
  if (onProgreso) onProgreso(100, leidos);
  return destino;
}

/** Nombre seguro para Windows (sin : * ? " < > | ni rutas). */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 150);
  return limpio || "archivo";
}
