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
  causa: "cookies" | "bot" | "privado" | "geo" | "formato" | "disco" | "red" | "motor" | "noexiste" | "sesion" | "bloqueo" | "proveedor" | "sinSoporte" | "otro";
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
  // El sitio devolvió su página de LOGIN en vez del contenido. yt-dlp lo
  // reporta como «Unsupported URL: https://www.facebook.com/login/?next=…»,
  // así que sin esta línea el usuario leía «ningún motor sabe leer ese link»
  // cuando en realidad le faltaba la sesión.
  if (/\/login|login\?next|\/signin|\/accounts\/login|accounts\.google\.com|consent\.|checkpoint/.test(m)) return "sesion";
  // «Unsupported URL» = ningún motor conoce ese sitio; NO es un formato que
  // falte (el usuario veía «ese formato no existe» en links de Apple Music).
  if (/unsupported url|is not a valid url|no suitable extractor|is not supported/.test(m)) return "sinSoporte";
  if (/requested format is not available|no video formats found/.test(m)) return "formato";
  if (/no space left|disk full|enospc|espacio insuficiente/.test(m)) return "disco";
  // OJO: antes esta línea atrapaba «not found» en general, así que un pin de
  // Pinterest inexistente o un 404 del sitio se anunciaban como «falta un motor
  // en vendor». Ahora «motor» es SOLO un binario que no aparece.
  if (/enoent|no such file or directory|cannot find the file|winerror 2|is not recognized as an internal|command not found/.test(m)) return "motor";
  // El contenido no existe / se borró.
  if (/http error 404|\b404\b|not found|does not exist|no longer available|requested .* could not be found|unavailable video|has been removed|no video (could be found|found|in this)|no media|nothing to download/.test(m)) return "noexiste";
  // El sitio pide cuenta o sesión (no es lo mismo que contenido privado).
  if (/only works when logged-?in|account authentication is required|requires? authentication|authentication is required|log ?in to|empty media response|not granting access|login required|sign in to/.test(m)) return "sesion";
  // Bloqueo de bots/CDN a nivel de red (WAF).
  if (/http error 41[0-9]|http error 40[36]|forbidden|access denied|cloudflare|ddos-guard|precondition failed/.test(m)) return "bloqueo";
  // Spotify: encontró la canción pero YouTube no dio el audio.
  if (/audioprovidererror|yt-dlp download error|spotdl.*error/.test(m)) return "proveedor";
  if (/getaddrinfo|connection|timed? ?out|network is unreachable|10054|10053|ssl/.test(m)) return "red";
  return "otro";
}

/**
 * Devuelve el error en español. `titulo` es corto (cabe en una línea de la cola)
 * y `arreglo` dice qué hacer.
 */
export function explicarError(msg: string | undefined | null): ErrorExplicado {
  // Colgado ≠ fallo del sitio: hay que decirlo con sus propias palabras.
  if (/dejó de responder|sin avances|se quedó colgado/i.test(msg ?? "")) {
    return {
      causa: "otro",
      titulo: "El motor se quedó colgado y se detuvo solo",
      arreglo:
        "No llegó ningún dato en 8 minutos, así que Linyue lo cortó para no bloquear la cola. Reintenta; si se repite, prueba otro motor o revisa la conexión/proxy.",
    };
  }
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
    case "sinSoporte":
      return {
        causa,
        titulo: "Ningún motor sabe leer ese link",
        arreglo:
          "El sitio no está entre los que entienden yt-dlp, gallery-dl o spotdl (o el link es de una página, no del archivo). Prueba el link directo del vídeo/audio, o el mismo contenido en YouTube o Spotify.",
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
    case "noexiste":
      return {
        causa,
        titulo: "Ese contenido ya no existe en el sitio",
        arreglo: "Comprueba el link en el navegador: puede estar borrado, ser privado o haberse movido.",
      };
    case "sesion":
      return {
        causa,
        titulo: "El sitio pide una cuenta (sesión)",
        arreglo: "Este contenido solo se ve con sesión iniciada. Entra en la pestaña Cookies, pega tu cookies.txt de ese sitio y reintenta.",
      };
    case "bloqueo":
      return {
        causa,
        titulo: "El sitio está bloqueando las peticiones automáticas",
        arreglo: "Es su cortafuegos (Cloudflare/412/406). Con cookies del navegador suele pasar; si no, prueba un proxy en Ajustes → Red o espera un rato.",
      };
    case "proveedor":
      return {
        causa,
        titulo: "La canción se encontró, pero YouTube no entregó el audio",
        arreglo: "YouTube pidió confirmación (bot/cookies) al buscar el audio de Spotify. Activa cookies del navegador en Ajustes y reintenta; Linyue intentará además la vía directa.",
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
