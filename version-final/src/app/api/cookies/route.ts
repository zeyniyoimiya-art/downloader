// Gestor de cookies por sitio: guardar, borrar, estado y "probar sesión"
import { guard, blocked } from "@/lib/server/guard";
import fs from "node:fs";
import { z } from "zod";
import { cookieFile } from "@/lib/server/store";
import { getEngines, isHealthy, MOCK } from "@/lib/server/engines";
import { runCapture } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

const SITES = { youtube: "https://www.youtube.com/feed/history", instagram: "https://www.instagram.com/instagram/", x: "https://x.com/home", tiktok: "https://www.tiktok.com/foryou" } as const;
const Site = z.enum(["youtube", "instagram", "x", "tiktok"]);

export async function GET() {
  return Response.json(Object.keys(SITES).map((s) => {
    const f = cookieFile(s);
    const exists = fs.existsSync(f);
    return { site: s, present: exists, updated: exists ? fs.statSync(f).mtimeMs : null, lines: exists ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).length : 0 };
  }));
}
export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const parsed = z.object({ site: Site, content: z.string().min(10).max(500_000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Contenido inválido" }, { status: 400 });
  // Validación mínima del formato Netscape
  if (!/\t(TRUE|FALSE)\t/.test(parsed.data.content)) return Response.json({ error: "No parece un cookies.txt en formato Netscape" }, { status: 400 });
  fs.writeFileSync(cookieFile(parsed.data.site), parsed.data.content, { mode: 0o600 });
  return Response.json({ ok: true });
}
export async function DELETE(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const s = Site.safeParse(new URL(req.url).searchParams.get("site"));
  if (!s.success) return Response.json({ error: "Sitio inválido" }, { status: 400 });
  fs.rmSync(cookieFile(s.data), { force: true });
  return Response.json({ ok: true });
}
export async function PUT(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const s = Site.safeParse((await req.json().catch(() => ({})))?.site);
  if (!s.success) return Response.json({ error: "Sitio inválido" }, { status: 400 });
  const f = cookieFile(s.data);
  if (!fs.existsSync(f)) return Response.json({ ok: false, message: "No hay cookies guardadas" });
  if (MOCK) return Response.json({ ok: true, message: "Sesión simulada válida" });
  await getEngines();
  if (!isHealthy("yt-dlp")) return Response.json({ ok: false, message: "yt-dlp no disponible para probar" });
  try {
    await runCapture("yt-dlp", ["--cookies", f, "--flat-playlist", "--playlist-end", "1", "--skip-download", "--dump-single-json", "--", SITES[s.data]], 30000);
    return Response.json({ ok: true, message: "Probe autenticado correcto" });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "Falló" });
  }
}
