// Cola de descargas: listar, encolar y limpiar terminados
import { z } from "zod";
import { clearFinished, enqueue, listJobs } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

const Body = z.object({
  urls: z.array(z.string().max(2048)).min(1).max(200),
  mode: z.enum(["audio", "video", "photo", "profile", "all", "photo_video", "audio_photo"]),
  format: z.string().regex(/^[a-z0-9]{2,8}$/),
  quality: z.string().regex(/^(best|\d{3,4})$/),
});

export async function GET() {
  return Response.json(listJobs());
}
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { urls, mode, format, quality } = parsed.data;
  return Response.json(enqueue(urls, mode, format, quality));
}
export async function DELETE() {
  clearFinished();
  return Response.json({ ok: true });
}
