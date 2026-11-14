// Pruebas de REGRESIÓN sobre las rutas de la API que fallaban en uso real.
//
// No son tests de conveniencia: cada uno reproduce un fallo que se vio con
// yt-dlp de verdad y el navegador delante.
//
//  1. `POST /api/probe` contestaba exactamente 2 bytes (`{}`) y la ficha se
//     quedaba en «Inspeccionando…» para siempre. Causa: la promesa interna
//     devolvía un `Response` y la ruta lo envolvía otra vez con `Response.json`,
//     que serializa un objeto Response → `{}`.
//  2. `DELETE /api/subs` recibía el id en el CUERPO de la petición, la ruta lo
//     buscaba en la query → 404 y quitar una suscripción nunca funcionaba.
import { describe, expect, it, vi, beforeEach } from "vitest";

const INFO = {
  title: "Me at the zoo",
  uploader: "jawed",
  duration: 19,
  thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
  upload_date: "20050424",
  view_count: 700000000,
  formats: [
    { height: 240, filesize: 475961, ext: "mp4" },
    { height: 144, filesize: 120000, ext: "mp4" },
  ],
};

const runCapture = vi.fn(async () => JSON.stringify(INFO));

vi.mock("@/lib/server/jobs", () => ({ runCapture: (...a: unknown[]) => runCapture(...(a as [])) }));
vi.mock("@/lib/server/engines", () => ({
  MOCK: false,
  getEngines: async () => [],
  isHealthy: () => true,
  resolveEngine: (n: string) => (n === "yt-dlp" ? "/usr/local/bin/yt-dlp" : null),
}));
vi.mock("@/lib/server/store", () => ({
  getConfig: () => ({ altEngineCN: false, probeConcurrency: 4, profileLimit: 50, outputDir: "/tmp/salida" }),
  cookieFile: () => "/tmp/sin-cookies.txt",
}));
vi.mock("@/lib/server/probe-cache", () => ({
  alturasDe: (j: { formats?: { height?: number }[] }) =>
    [...new Set((j.formats ?? []).map((f) => f.height).filter((h): h is number => typeof h === "number"))].sort((a, b) => b - a),
  tamanoDe: (j: { formats?: { filesize?: number }[] }) =>
    (j.formats ?? []).map((f) => f.filesize ?? 0).sort((a, b) => b - a)[0] ?? 0,
  claveSonda: (u: string, m: string) => `${m}::${u}`,
  leerSonda: () => null,
  guardarSonda: () => {},
}));

import { POST as probePOST } from "@/app/api/probe/route";

const pedir = (cuerpo: unknown) =>
  new Request("http://127.0.0.1:3000/api/probe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-linyue": "1", host: "127.0.0.1:3000" },
    body: JSON.stringify(cuerpo),
  });

beforeEach(() => runCapture.mockClear());

describe("POST /api/probe (vista previa)", () => {
  it("devuelve la ficha completa, no un objeto vacío", async () => {
    const r = await probePOST(pedir({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video" }));
    expect(r.status).toBe(200);
    const crudo = await r.text();
    // El fallo original: exactamente "{}" (2 bytes).
    expect(crudo.length).toBeGreaterThan(20);
    const d = JSON.parse(crudo);
    expect(d).not.toEqual({});
    expect(d.title).toBe("Me at the zoo");
    expect(d.author).toBe("jawed");
    expect(d.duration).toBe(19);
    expect(d.date).toBe("24/04/2005");
    expect(d.heights).toEqual([240, 144]);
    expect(d.size).toBe(475961);
    expect(d.thumbnail).toContain("i.ytimg.com");
    expect(d.engine).toBe("yt-dlp");
    expect(d.platform).toBe("YouTube");
  });

  it("nunca mete un Response dentro de otro Response", async () => {
    const r = await probePOST(pedir({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "audio" }));
    const d = await r.json();
    // Un Response serializado deja rastro de que es un objeto raro; aquí se exige
    // que todos los campos sean datos planos.
    for (const v of Object.values(d)) {
      expect(["string", "number", "boolean", "object"]).toContain(typeof v);
      expect(v).not.toBeInstanceOf(Response);
    }
  });

  it("rechaza un link inválido con 400 y explicación", async () => {
    const r = await probePOST(pedir({ url: "no es un link", mode: "video" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Link inválido");
  });

  it("si la sonda falla, lo dice en español en vez de quedarse callada", async () => {
    runCapture.mockRejectedValueOnce(new Error("ERROR: [youtube] jNQXAC9IVRw: Video unavailable"));
    const r = await probePOST(pedir({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video" }));
    const d = await r.json();
    expect(r.status).toBe(200); // la ficha se pinta igual, con aviso
    expect(d.note).toBeTruthy();
    expect(d.note).toMatch(/Sin vista previa/);
  });

  it("sin la cabecera x-linyue no se sonda nada (anti-CSRF)", async () => {
    const r = await probePOST(
      new Request("http://127.0.0.1:3000/api/probe", {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", mode: "video" }),
      }),
    );
    expect(r.status).toBe(403);
    expect(runCapture).not.toHaveBeenCalled();
  });
});

describe("contrato de DELETE /api/subs", () => {
  // El fallo real: el cliente mandaba `{ id }` en el cuerpo. La ruta lee la
  // query, así que el id correcto es `?id=…`. Este test fija el contrato para
  // que un cambio en cualquiera de los dos lados salte aquí y no en la app.
  it("lee el id de la query, no del cuerpo", async () => {
    const fuente = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/subs/route.ts", "utf8"),
    );
    expect(fuente).toMatch(/searchParams\.get\("id"\)/);
  });

  it("el cliente de la página principal usa la query", async () => {
    const fuente = await import("node:fs").then((fs) => fs.readFileSync("src/app/page.tsx", "utf8"));
    expect(fuente).toMatch(/\/api\/subs\?id=/);
    expect(fuente).not.toMatch(/api\/subs",\s*\{\s*method:\s*"DELETE",\s*headers[^}]*\},\s*body/);
  });
});
