// Panel "Motor vivo": estado de los 12 motores y re-escaneo
import { getEngines, scanEngines } from "@/lib/server/engines";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getEngines());
}
export async function POST() {
  return Response.json(await scanEngines());
}
