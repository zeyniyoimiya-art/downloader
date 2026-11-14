// Suscripciones en disco + la revisión de verdad (la que lanza el motor).
//
// Archivo: ~/.linyue/subs.json (junto a config.json e history.json).
// Escritura atómica (tmp + rename) por la misma razón que la cola: un corte de
// luz a mitad de guardado no puede dejar el archivo truncado y sin suscripciones.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DATA_DIR, getConfig } from "./store";
import { enqueue } from "./jobs";
import { MOCK, resolveEngine } from "./engines";
import {
  nuevosIds, parseListado, podarVistos, proximaRevision, tocaRevisar, urlDesdeId,
  horasValidas, type Sub,
} from "../shared/subs";

const SUBS_FILE = path.join(DATA_DIR, "subs.json");
let cache: Sub[] | null = null;

function leer(): Sub[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(SUBS_FILE, "utf8"));
    cache = Array.isArray(raw) ? (raw as Sub[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function guardar(): void {
  const tmp = SUBS_FILE + ".tmp";
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cache ?? [], null, 1));
  fs.renameSync(tmp, SUBS_FILE); // rename es atómico en el mismo volumen
}

export const listarSubs = (): Sub[] => [...leer()];

export function agregarSub(url: string, opts: Partial<Pick<Sub, "mode" | "format" | "quality" | "label" | "everyHours" | "maxNuevos">> = {}): Sub {
  const subs = leer();
  // Una URL repetida no se duplica: se devuelve la que ya está.
  const ya = subs.find((s) => s.url === url);
  if (ya) return ya;
  const ahora = Date.now();
  const sub: Sub = {
    id: randomUUID().slice(0, 8),
    url,
    label: opts.label?.trim() || url,
    mode: opts.mode ?? "video",
    format: opts.format ?? "mp4",
    quality: opts.quality ?? "1080",
    everyHours: horasValidas(opts.everyHours ?? getConfig().subsEveryHours),
    lastCheck: 0,
    // La primera revisión no se hace al instante: se da margen para que la app
    // termine de arrancar y para que el usuario pueda borrarla si se equivocó.
    nextCheck: ahora,
    seen: [],
    maxNuevos: Math.max(1, Math.min(20, opts.maxNuevos ?? 5)),
    lastResult: "recién añadida · primera revisión pendiente",
  };
  subs.push(sub);
  cache = subs;
  guardar();
  return sub;
}

export function borrarSub(id: string): boolean {
  const subs = leer();
  const i = subs.findIndex((s) => s.id === id);
  if (i < 0) return false;
  subs.splice(i, 1);
  cache = subs;
  guardar();
  return true;
}

export function editarSub(id: string, cambios: Partial<Pick<Sub, "everyHours" | "mode" | "format" | "quality" | "label">>): Sub | null {
  const subs = leer();
  const sub = subs.find((s) => s.id === id);
  if (!sub) return null;
  Object.assign(sub, cambios);
  if (cambios.everyHours != null) sub.everyHours = horasValidas(cambios.everyHours);
  cache = subs;
  guardar();
  return sub;
}

/** Título legible del canal o de la lista («jawed - Videos» → «jawed»). */
async function nombreDe(url: string): Promise<string | null> {
  if (MOCK) return null;
  const ytdlp = resolveEngine("yt-dlp");
  if (!ytdlp) return null;
  const r = await correr(ytdlp, [
    "--flat-playlist", "--no-warnings", "--no-colors", "--playlist-end", "1",
    "--print", "%(playlist_title|)s|%(uploader|)s|%(channel|)s", "--", url,
  ], 30000);
  if (r.code !== 0) return null;
  const campos = (r.out.split(/\r?\n/).find((l) => l.trim()) ?? "").split("|").map((x) => x.trim());
  const nombre = campos.find((x) => x.length > 0) ?? "";
  return nombre.replace(/\s+-\s+(videos|shorts|streams|playlists|视频|短视频)$/i, "").trim() || null;
}

/** Ejecuta un motor y devuelve su salida (o el error), con timeout. */
function correr(bin: string, args: string[], timeoutMs = 120000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = "", err = "";
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, timeoutMs);
    p.stdout.on("data", (d) => { out += String(d); });
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}

export interface ResultadoRevision {
  ok: boolean;
  nuevos: number;
  encolados: string[];
  mensaje: string;
}

/**
 * Revisa una suscripción: pregunta al sitio por la lista, compara con lo ya
 * visto y encola lo nuevo.
 *
 * `--flat-playlist` es clave: pide la LISTA, no los vídeos. En un canal de 5000
 * elementos tarda segundos en vez de horas.
 */
export async function revisarSub(sub: Sub): Promise<ResultadoRevision> {
  const cfg = getConfig();
  const ahora = Date.now();
  // OJO: el binario se llama `ytdlp.exe` en el ZIP (alias de yt-dlp). Buscarlo
  // como «yt-dlp.exe» a pelo hacía que NINGUNA suscripción funcionara nunca.
  const ytdlp = resolveEngine("yt-dlp");
  if (!ytdlp) {
    sub.lastCheck = ahora; sub.nextCheck = proximaRevision(sub.everyHours, ahora);
    sub.lastResult = "error: yt-dlp no encontrado (Ajustes → Motor vivo)";
    guardar();
    return { ok: false, nuevos: 0, encolados: [], mensaje: sub.lastResult };
  }
  const limite = Math.min(50, Math.max(10, cfg.profileLimit));

  let salida = "";
  if (MOCK) {
    // Modo simulado (tests y demos): lista inventada y estable.
    salida = Array.from({ length: 3 }, (_, i) => `mock${sub.id}${i} https://www.youtube.com/watch?v=mock${sub.id}${i}`).join("\n");
  } else {
    const r = await correr(ytdlp, [
      "--flat-playlist", "--no-warnings", "--no-colors",
      "--playlist-end", String(limite),
      "--print", "%(id)s %(url)s",
      "--", sub.url,
    ]);
    if (r.code !== 0) {
      const err = (r.err || r.out).split("\n").filter(Boolean).pop() ?? "el motor falló";
      sub.fallos = (sub.fallos ?? 0) + 1;
      sub.lastCheck = ahora;
      sub.nextCheck = proximaRevision(sub.everyHours, ahora);
      sub.lastResult = `error: ${err.slice(0, 160)}`;
      guardar();
      return { ok: false, nuevos: 0, encolados: [], mensaje: sub.lastResult };
    }
    salida = r.out;
  }

  const listado = parseListado(salida);
  const ids = listado.map((e) => e.id);
  const nuevos = nuevosIds(sub.seen, ids, sub.maxNuevos);
  const encolados: string[] = [];

  for (const id of nuevos) {
    const entrada = listado.find((e) => e.id === id);
    const url = entrada?.url ?? urlDesdeId(sub.url, id);
    if (!url) continue; // sin URL fiable no se inventa nada
    enqueue([url], sub.mode as "audio" | "video" | "photo", sub.format, sub.quality, undefined, 0, { from: "sub" });
    encolados.push(url);
  }

  // Nombre legible: si la etiqueta sigue siendo la URL (nadie la escribió), se
  // pregunta una sola vez por el título del canal/lista. Sin esto la lista de
  // suscripciones era una columna de URLs.
  if (!sub.label || sub.label === sub.url || /^https?:\/\//i.test(sub.label)) {
    const nombre = await nombreDe(sub.url);
    if (nombre) sub.label = nombre;
  }

  sub.seen = podarVistos([...ids, ...sub.seen]);
  sub.lastCheck = ahora;
  sub.nextCheck = proximaRevision(sub.everyHours, ahora);
  sub.fallos = 0;
  sub.lastResult = encolados.length
    ? `${encolados.length} nuevo(s) en cola`
    : `sin novedades (${ids.length} elementos vistos)`;
  // Si el motor no dio nombre, se aprovecha la URL como etiqueta legible.
  if (!sub.label || sub.label === sub.url) sub.label = sub.url;
  guardar();
  return { ok: true, nuevos: encolados.length, encolados, mensaje: sub.lastResult };
}

// ── Temporizador ────────────────────────────────────────────────────────────
// Se arma cuando alguien abre la app. Cada minuto mira si a alguna suscripción
// le toca revisión; si no toca nada, no gasta ni una petición de red.
const g = globalThis as typeof globalThis & { __lySubsTimer?: ReturnType<typeof setInterval> };

export function asegurarTemporizador(): void {
  if (g.__lySubsTimer) return;
  g.__lySubsTimer = setInterval(() => {
    if (!getConfig().subsEnabled) return;
    revisarPendientes().catch(() => {});
  }, 60_000);
  // No mantener vivo el proceso solo por este temporizador.
  g.__lySubsTimer.unref?.();
}

/** Revisa solo las que ya tocan (usado por el temporizador y por «Revisar todo»). */
export async function revisarPendientes(forzar = false): Promise<ResultadoRevision[]> {
  const ahora = Date.now();
  const pendientes = leer().filter((s) => forzar || tocaRevisar(s, ahora));
  const res: ResultadoRevision[] = [];
  // De una en una: cinco motores a la vez contra el mismo sitio es pedir un 429.
  for (const s of pendientes) res.push(await revisarSub(s));
  return res;
}
