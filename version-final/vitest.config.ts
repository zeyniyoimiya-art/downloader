import { defineConfig } from "vitest/config";
import path from "node:path";

// Los tests importan los módulos con el mismo alias que la app (`@/…`), para
// poder probar las rutas de la API tal cual se ejecutan en producción. Sin esto
// había que copiar rutas relativas larguísimas y los tests de rutas no existían.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
