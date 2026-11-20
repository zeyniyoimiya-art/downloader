import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── Sin compresion HTTP ──────────────────────────────────────────────────
  // Es una app local: comprimir no ahorra nada que importe en loopback y sí
  // añade una pieza más al camino crítico (negociar `Accept-Encoding`,
  // comprimir, descomprimir). Quitarla elimina de golpe una familia entera de
  // respuestas raras que un navegador puede rechazar y un `curl` no.
  compress: false,
};

export default nextConfig;
