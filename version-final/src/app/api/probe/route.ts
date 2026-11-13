// Vista previa por link: yt-dlp --dump-json (título, duración, miniatura, resoluciones, motor)
import { z } from "zod";
import fs from "node:fs";
import { detect, modeParts, primaryMode, routeEngine, supportedModes } from "@/lib/shared/platforms";
import { browserUAFor } from "@/lib/shared/args";
import { getEngines, isHealthy, MOCK, resolveEngine } from "@/lib/server/engines";
import { runCapture } from "@/lib/server/jobs";
import { cookieFile, getConfig } from "@/lib/server/store";
export const dynamic = "force-dynamic";

const Body = z.object({ url: z.string().max(2048), mode: z.enum(["audio", "video", "photo", "profile", "all", "photo_video", "audio_photo"]) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const d = parsed.success ? detect(parsed.data.url) : null;
  if (!parsed.success || !d) return Response.json({ error: "Link inválido" }, { status: 400 });
  await getEngines();
  const cfg = getConfig();
  // Un modo combinado («Fotos + Video») genera VARIOS trabajos, cada uno con su
  // motor. Anunciar solo el del primero confundía: para un MP4 directo la ficha
  // decía «gallerydl» aunque la descarga real la hacía yt-dlp.
  const partes = modeParts(parsed.data.mode).filter((p) => supportedModes(d).includes(p));
  const motores = [...new Set((partes.length ? partes : [primaryMode(parsed.data.mode)])
    .map((p) => routeEngine(d, p, { altEngineCN: cfg.altEngineCN, healthy: isHealthy })))];
  const engine = motores[0];
  const base = { url: d.url, platform: d.label, color: d.color, kind: d.kind, engine, engines: motores };
  // Spotify: yt-dlp se niega en rotundo ("[DRM] known to use DRM protection") y
  // un link de Spotify siempre acaba en spotdl, así que la vista previa NUNCA
  // funcionaba. Su API pública de oEmbed da título, autor y carátula sin
  // credenciales ni sesión.
  if (d.platform === "spotify") {
    try {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(d.url)}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const o = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        return Response.json({ ...base, title: o.title || d.url, author: o.author_name || "", duration: 0, thumbnail: o.thumbnail_url || "", heights: [], note: `Se descargará con ${motores.join(" + ")}` });
      }
    } catch { /* sin red o sin oEmbed: se cae al mensaje genérico de abajo */ }
  }
  if (MOCK) return Response.json({ ...base, title: `Demo · ${d.label}`, author: "Lin Yue", duration: 215, thumbnail: "", heights: [2160, 1080, 720] });
  // ── La vista previa debe usar el MISMO motor que va a descargar ───────────
  // yt-dlp dice "[twitter] Media #1 is not a video" en un post de FOTOS y no
  // sabe nada de un perfil de Instagram: para esos links se sondea con su
  // motor real en vez de dar un error incomprensible.
  if (engine === "gallerydl" && resolveEngine("gallerydl")) {
    try {
      const ck = cookieFile(d.platform);
      const pargs = ["-j", "--range", "1-1", "--", d.url];
      if (fs.existsSync(ck)) pargs.unshift("--cookies", ck);
      const crudo = await runCapture("gallerydl", pargs, 45000);
      // OJO: gallery-dl imprime el JSON CON SANGRÍA (varias líneas), no un JSON
      // por línea. Hay que parsear la salida COMPLETA. Estructura: [[<n>, {…info…}]]
      const parsed = JSON.parse(crudo.trim()) as unknown;
      const filas = Array.isArray(parsed) ? parsed : [parsed];
      const fila = filas[0];
      const info = (Array.isArray(fila) ? [...fila].reverse().find((x) => x && typeof x === "object" && !Array.isArray(x)) : fila) as Record<string, unknown> | undefined;
      const autor = (info?.author ?? info?.user ?? {}) as Record<string, unknown>;
      const texto = String(info?.content ?? info?.description ?? "").replace(/\s+/g, " ").trim();
      const total = typeof info?.count === "number" ? info.count : undefined;
      return Response.json({
        ...base,
        title: texto || d.url,
        author: String(autor.nick ?? autor.name ?? autor.username ?? ""),
        duration: 0, thumbnail: "", heights: [],
        entries: total,
        note: `Se descargará con ${motores.join(" + ")}`,
      });
    } catch { /* sin vista previa, cae al mensaje genérico de abajo */ }
  }
  // instaloader no tiene un volcado de metadatos cómodo: mejor explicar qué va
  // a pasar que soltar el error crudo de yt-dlp.
  if (engine === "instaloader") {
    return Response.json({
      ...base, title: d.url, author: "", duration: 0, thumbnail: "", heights: [],
      note: `Perfil de Instagram: se bajará con ${motores.join(" + ")} (hasta ${cfg.profileLimit} publicaciones). La vista previa no está disponible para perfiles.`,
    });
  }
  // Sondamos SIEMPRE que el binario exista, sin fiarnos del flag de salud.
  // `isHealthy` sale de un escaneo cacheado que puede haberse quedado corto por
  // contención de disco/CPU (varios binarios de 40-95 MB arrancando a la vez);
  // fiarse de él dejaba la vista previa muerta durante toda la sesión.
  if (!resolveEngine("yt-dlp")) {
    return Response.json({ ...base, title: d.url, author: "", duration: 0, thumbnail: "", heights: [], note: "yt-dlp no encontrado: no se puede previsualizar" });
  }
  try {
    const args = ["--dump-single-json", "--no-playlist", "--skip-download", "--flat-playlist"];
    args.push(...browserUAFor(d.url)); // Bilibili WAF: sin UA de navegador no devuelve formatos
    const ck = cookieFile(d.platform);
    if (fs.existsSync(ck)) args.push("--cookies", ck);
    // 90 s, no 30: cuando hay un proveedor de PO Tokens instalado (bgutil), cada
    // sondeo lanza además su propio proceso de JS para generar el token, y con
    // varias sondas en paralelo eso pasa de 30 s con facilidad. Con 30 s las
    // fichas se quedaban en "timeout" y nunca se rellenaban.
    const j = JSON.parse(await runCapture("yt-dlp", [...args, "--", d.url], 90000));
    const heights = [...new Set(((j.formats ?? []) as { height?: number }[]).map((f) => f.height).filter((h): h is number => !!h))].sort((a, b) => b - a);
    const note = motores.join(" + ") !== "yt-dlp" ? `Se descargará con ${motores.join(" + ")}` : undefined;
    const fecha = typeof j.upload_date === "string" && j.upload_date.length === 8
      ? `${j.upload_date.slice(6, 8)}/${j.upload_date.slice(4, 6)}/${j.upload_date.slice(0, 4)}`
      : undefined;
    const views = typeof j.view_count === "number" ? j.view_count : undefined;
    return Response.json({ ...base, title: j.title || d.url, author: j.uploader || j.channel || "", duration: j.duration || 0, thumbnail: j.thumbnail || "", heights, entries: j.entries?.length, date: fecha, views, note });
  } catch (e) {
    // Devolvemos el motivo REAL en vez de un mensaje genérico: así se ve si fue
    // por cookies, por un link privado o porque el sitio cambió.
    const motivo = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 180);
    return Response.json({ ...base, title: d.url, author: "", duration: 0, thumbnail: "", heights: [], note: `Se usará ${motores.join(" + ")}; sin vista previa${motivo ? ` — ${motivo}` : ""}` });
  }
}
