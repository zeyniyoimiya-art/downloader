// Traducción de los errores de los motores a algo que se pueda accionar.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
// yt-dlp escribe errores pensados para quien lee su código fuente:
//
//   ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/
//   yt-dlp/issues/7271 for more info
//
// Eso, en la cola de una app de escritorio, no dice NADA: ni qué pasó, ni qué
// hacer. Aquí se reconoce el patrón y se devuelve una frase en español con la
// causa y el arreglo. El texto original NUNCA se pierde: se sigue guardando en
// el log del trabajo, por si hay que pegarlo en un issue.
//
// Todo puro: sin fs, sin red, testeable.

export interface ErrorExplicado {
  /** Una línea para la cola. */
  titulo: string;
  /** Qué hacer, en una frase. */
  arreglo: string;
  /** Clave estable de la causa, para decidir reintentos. */
  causa: "cookies" | "bot" | "privado" | "geo" | "formato" | "disco" | "red" | "motor" | "otro";
}

/** ¿El fallo viene de no poder leer la base de cookies del navegador? */
export function esErrorDeCookies(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return /could not copy .*(cookie|login) database|failed to decrypt|permission denied .*cookies|CookieDatabaseLocked|CopyCookieFile/i.test(msg);
}

/** Causa probable, sin tocar el texto. */
export function causaDeError(msg: string | undefined | null): ErrorExplicado["causa"] {
  const m = (msg ?? "").toLowerCase();
  if (!m) return "otro";
  if (esErrorDeCookies(msg)) return "cookies";
  if (/confirm you.?re not a bot|sign in to confirm|captcha|http error 429|too many requests/.test(m)) return "bot";
  if (/private video|members-only|join this channel|requires payment|login required|iniciar sesión/.test(m)) return "privado";
  if (/not available in your country|geo.?restrict|blocked it in your country/.test(m)) return "geo";
  if (/requested format is not available|no video formats found|unsupported url|is not a valid url/.test(m)) return "formato";
  if (/no space left|disk full|enospc|espacio insuficiente/.test(m)) return "disco";
  if (/getaddrinfo|connection|timed? ?out|network is unreachable|10054|10053|ssl/.test(m)) return "red";
  if (/enoent|not ?found|no such file|cannot find|winerror 2/.test(m)) return "motor";
  return "otro";
}

/**
 * Devuelve el error en español. `titulo` es corto (cabe en una línea de la cola)
 * y `arreglo` dice qué hacer.
 */
export function explicarError(msg: string | undefined | null): ErrorExplicado {
  const causa = causaDeError(msg);
  switch (causa) {
    case "cookies":
      return {
        causa,
        titulo: "No se pudo leer la base de cookies del navegador",
        arreglo:
          "Chrome/Edge/Brave bloquean su base de cookies mientras están abiertos (y Chrome 127+ la cifra de una forma que yt-dlp no puede leer). Ciérralo del todo y reintenta, o exporta las cookies a un archivo desde la pestaña Cookies.",
      };
    case "bot":
      return {
        causa,
        titulo: "El sitio pide confirmar que no eres un robot",
        arreglo:
          "Suele ser el límite por IP. Espera unos minutos, activa cookies del navegador en Ajustes (con el navegador CERRADO), o usa una VPN/proxy.",
      };
    case "privado":
      return {
        causa,
        titulo: "El contenido necesita una cuenta con acceso",
        arreglo: "Inicia sesión en ese sitio y usa sus cookies (pestaña Cookies), o descarga desde una cuenta que tenga permiso.",
      };
    case "geo":
      return {
        causa,
        titulo: "Bloqueado por país",
        arreglo: "Ese vídeo solo se puede ver desde otra región: configura un proxy en Ajustes → Red.",
      };
    case "formato":
      return {
        causa,
        titulo: "Ese formato no existe en este contenido",
        arreglo: "Prueba otro formato o calidad (el sitio puede ofrecer solo audio, o solo un contenedor).",
      };
    case "disco":
      return {
        causa,
        titulo: "No queda espacio en disco",
        arreglo: "Libera espacio en la carpeta de salida o cambia la carpeta en Ajustes.",
      };
    case "red":
      return {
        causa,
        titulo: "Se cortó la conexión con el sitio",
        arreglo: "Comprueba tu red y reintenta; si usas proxy, revisa que responda.",
      };
    case "motor":
      return {
        causa,
        titulo: "Falta un archivo o un motor en la carpeta vendor",
        arreglo: "Revisa Ajustes → Motor vivo: en rojo aparece el binario que no se encuentra.",
      };
    default: {
      // Sin patrón conocido: se enseña el original, pero limpio («ERROR:» fuera y
      // sin las líneas de stack de Python que no aportan nada).
      const limpio = (msg ?? "")
        .split(/\r?\n/)
        .map((l) => l.replace(/^ERROR:\s*/i, "").trim())
        .filter((l) => l && !/^File "/.test(l) && !/^Traceback/.test(l))
        .slice(0, 2)
        .join(" · ")
        .slice(0, 200);
      return { causa, titulo: limpio || "Falló la descarga", arreglo: "" };
    }
  }
}

/** «Título — arreglo» en una sola línea, para el aviso del sistema. */
export function errorParaAviso(msg: string | undefined | null): string {
  const e = explicarError(msg);
  return e.arreglo ? `${e.titulo}. ${e.arreglo}` : e.titulo;
}
