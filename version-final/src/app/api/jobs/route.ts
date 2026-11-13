// Cola de descargas: listar, encolar y limpiar terminados
import { guard, blocked } from "@/lib/server/guard";
import { z } from "zod";
import { clearFinished, enqueue, listJobs } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

const Body = z.object({
  urls: z.array(z.string().max(2048)).min(1).max(200),
  mode: z.enum(["audio", "video", "photo", "profile", "all", "photo_video", "audio_photo"]),
  format: z.string().regex(/^[a-z0-9]{2,8}$/),
  quality: z.string().regex(/^(best|\d{3,4})$/),
  /** Códec para este encargo (opcional: si falta, se usa el de Ajustes). */
  codec: z.enum(["auto", "h264", "h265", "av1", "vp9", "vp8", "mpeg4", "prores", "theora"]).optional(),
  /** Minutos de espera antes de arrancar (programar la descarga). 0 = ya. */
  delayMin: z.number().int().min(0).max(1440).optional(),
});

export async function GET() {
  return Response.json(listJobs());
}
export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { urls, mode, format, quality, codec, delayMin } = parsed.data;
  return Response.json(enqueue(urls, mode, format, quality, codec, delayMin ?? 0));
}
export async function DELETE(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  clearFinished();
  return Response.json({ ok: true });
}
