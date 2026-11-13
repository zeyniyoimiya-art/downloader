// Suscripciones (fase 9): lista, alta, baja y «revisar ahora».
import { z } from "zod";
import { guard, blocked } from "@/lib/server/guard";
import { getConfig } from "@/lib/server/store";
import { agregarSub, asegurarTemporizador, borrarSub, editarSub, listarSubs, revisarPendientes, revisarSub } from "@/lib/server/subs";

export const dynamic = "force-dynamic";

export async function GET() {
  asegurarTemporizador();
  const cfg = getConfig();
  return Response.json({ subs: listarSubs(), enabled: cfg.subsEnabled, everyHours: cfg.subsEveryHours });
}

const Alta = z.object({
  action: z.enum(["add", "check", "checkAll", "update"]).optional(),
  url: z.string().url().max(500).optional(),
  id: z.string().max(40).optional(),
  label: z.string().max(80).optional(),
  everyHours: z.number().int().min(1).max(168).optional(),
  mode: z.enum(["audio", "video", "photo"]).optional(),
  format: z.string().max(20).optional(),
  quality: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  asegurarTemporizador();
  const parsed = Alta.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const d = parsed.data;

  if (d.action === "checkAll") {
    const r = await revisarPendientes(true);
    return Response.json({ subs: listarSubs(), resultado: r });
  }
  if (d.action === "check") {
    const sub = listarSubs().find((s) => s.id === d.id);
    if (!sub) return Response.json({ error: "No existe esa suscripción" }, { status: 404 });
    const r = await revisarSub(sub);
    return Response.json({ subs: listarSubs(), resultado: [r] });
  }
  if (d.action === "update" && d.id) {
    const sub = editarSub(d.id, { everyHours: d.everyHours, mode: d.mode, format: d.format, quality: d.quality, label: d.label });
    if (!sub) return Response.json({ error: "No existe esa suscripción" }, { status: 404 });
    return Response.json({ subs: listarSubs() });
  }
  if (!d.url) return Response.json({ error: "Falta la URL del canal o la playlist" }, { status: 400 });
  if (!/^https?:\/\//i.test(d.url)) return Response.json({ error: "La URL debe empezar por http:// o https://" }, { status: 400 });
  agregarSub(d.url, { label: d.label, everyHours: d.everyHours, mode: d.mode, format: d.format, quality: d.quality });
  return Response.json({ subs: listarSubs() });
}

export async function DELETE(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!borrarSub(id)) return Response.json({ error: "No existe esa suscripción" }, { status: 404 });
  return Response.json({ subs: listarSubs() });
}
