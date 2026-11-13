// Salud local: carpeta de datos escribible + caché de motores. Sin base de datos externa (persistencia JSON).
import fs from "node:fs";
import { DATA_DIR } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = `${DATA_DIR}/.health`;
    fs.writeFileSync(probe, String(Date.now()));
    fs.rmSync(probe, { force: true });
    return Response.json({ ok: true, dataDir: DATA_DIR, mode: "json" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
