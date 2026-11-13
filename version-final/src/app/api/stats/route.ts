// GET /api/stats — agregados del historial (todo local, nada sale de la máquina)
import { getHistory } from "@/lib/server/store";
import { calcularEstadisticas } from "@/lib/shared/stats";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(calcularEstadisticas(getHistory()));
}
