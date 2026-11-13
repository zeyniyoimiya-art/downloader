// Historial local (history.json)
import { getHistory, removeHistory } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getHistory());
}
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{1,12}$/.test(id)) return Response.json({ error: "id inválido" }, { status: 400 });
  removeHistory(id);
  return Response.json({ ok: true });
}
