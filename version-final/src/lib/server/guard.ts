// Defensa de la API local: anti-CSRF, anti-rebinding y anti-formularios.
//
// ── EL AGUJERO ───────────────────────────────────────────────────────────────
// La app escucha en 127.0.0.1 y NO tiene autenticación (correcto: es local).
// Pero "local" no significa "privado": cualquier página web que visites puede
// hacer peticiones a http://127.0.0.1:3000 desde TU navegador.
//
//   fetch("http://127.0.0.1:3000/api/jobs", {
//     method: "POST", mode: "no-cors",        // ← sin preflight, sin CORS
//     body: '{"urls":["…"],"mode":"video",…}'  // ← llega igual
//   })
//
// Detalles que lo hacían explotable:
//  · `req.json()` NO mira el Content-Type: un body con `text/plain` se parsea
//    igual, así que el "escudo" del preflight no aplicaba.
//  · `PUT /api/config` acepta `outputDir`: un sitio malicioso podía apuntar la
//    carpeta de salida a `C:\\Windows\\Temp` o al Escritorio y encolar descargas.
//  · `POST /api/open` abre el explorador de Windows: popups no solicitados.
//  · `DELETE /api/history` borra el historial.
//  · Con DNS rebinding (un dominio que resuelve a 127.0.0.1) ni siquiera hace
//    falta el truco de no-cors: el navegador cree que es el mismo origen.
//
// ── LA DEFENSA ───────────────────────────────────────────────────────────────
// 1. Toda petición que CAMBIA algo debe traer la cabecera `x-linyue: 1`. Una
//    cabecera personalizada no se puede enviar cross-origin sin un preflight
//    CORS que este servidor nunca aprueba. Es el patrón estándar anti-CSRF.
// 2. Se comprueba `Sec-Fetch-Site` (todos los navegadores modernos lo envían):
//    si dice `cross-site`, fuera.
// 3. Si llega `Origin`, debe coincidir con el Host de la petición.
// 4. Se exige `Host` de loopback para las rutas privilegiadas, lo que corta el
//    DNS rebinding (el navegador manda el dominio del atacante en Host).

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostDe(v: string | null): string {
  if (!v) return "";
  try { return new URL(v).host.toLowerCase(); } catch { return v.toLowerCase(); }
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * @param req       petición
 * @param loopback  si true, exige que el Host sea 127.0.0.1/localhost
 */
export function guard(req: Request, opts: { loopback?: boolean } = {}): GuardResult {
  const h = req.headers;

  // (2) Sec-Fetch-Site
  const sitio = h.get("sec-fetch-site");
  if (sitio && sitio !== "same-origin" && sitio !== "none") {
    return { ok: false, status: 403, error: "Petición de otro sitio bloqueada" };
  }

  // (3) Origin vs Host
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && host && hostDe(origin) !== host.toLowerCase()) {
    return { ok: false, status: 403, error: "Origen no coincide" };
  }

  // (4) loopback (anti DNS-rebinding)
  if (opts.loopback && host) {
    const soloHost = host.split(":")[0].toLowerCase();
    if (!["127.0.0.1", "localhost", "[::1]", "::1", "0.0.0.0"].includes(soloHost)) {
      return { ok: false, status: 403, error: "Host no local" };
    }
  }

  // (1) cabecera obligatoria en mutaciones
  if (MUTATING.has(req.method.toUpperCase()) && h.get("x-linyue") !== "1") {
    return { ok: false, status: 403, error: "Falta la cabecera x-linyue" };
  }
  return { ok: true };
}

/** Respuesta lista para devolver cuando el guard bloquea. */
export function blocked(r: Extract<GuardResult, { ok: false }>): Response {
  return Response.json({ error: r.error }, { status: r.status });
}
