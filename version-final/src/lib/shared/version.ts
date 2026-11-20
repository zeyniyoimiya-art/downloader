// Versión visible de la app.
//
// Sirve para algo muy concreto: cuando alguien dice «sigo con el mismo fallo»,
// lo primero que hay que descartar es que esté ejecutando el ZIP ANTERIOR. Esto
// se ve en Ajustes (y en /api/diagnostico) sin abrir nada más.
export const VERSION = "1.8.5";
export const BUILD = "2026-11-12";
export const SELLO = `v${VERSION} · ${BUILD}`;
