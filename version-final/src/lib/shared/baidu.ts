// Adaptador de Baidu: enlaces de 百度网盘 / 百度贴吧 / 百度文库.
//
// ── EL PROBLEMA ──────────────────────────────────────────────────────────────
// pan.baidu.com NO es una web de descargas: es un disco en la nube. Un enlace
// `/s/1AbCdEf` no apunta a un archivo, apunta a un RECURSO COMPARTIDO que hay
// que "转存" (transferir) a la nube de una cuenta y descargar después desde
// ahí. Sin cuenta no hay enlace directo, y el registro pide teléfono +86.
//
// Consecuencia técnica, dicha sin adornos: sin una cuenta de Baidu ya iniciada
// NO existe forma legítima de bajar ese archivo. Ni yt-dlp ni gallery-dl ni curl
// lo hacen; quien te prometa lo contrario te está vendiendo un proxy de cookies.
//
// Lo que SÍ se puede automatizar (y es lo que hace este módulo):
//   1. Detectar el enlace y separar `surl` y `pwd` (提取码) aunque vengan pegados
//      en el texto chino típico: "链接: https://pan.baidu.com/s/1abc 提取码: 1234".
//   2. Transferir + descargar en dos pasos con BaiduPCS-Go, que es el único
//      cliente serio que hace eso por línea de comandos. El login lo haces TÚ
//      una vez, dentro de BaiduPCS-Go: la app nunca ve tu BDUSS/STOKEN.

export type BaiduKind = "pan" | "tieba" | "wenku" | "other";

export interface BaiduInfo {
  kind: BaiduKind;
  /** Enlace limpio (sin el `?pwd=`), listo para pasarle al motor. */
  url: string;
  /** Código de 4 caracteres del recurso compartido (提取码). */
  pwd?: string;
  /** Identificador del recurso (`/s/<surl>`). */
  surl?: string;
  /** ¿Hace falta una cuenta de Baidu para esto? */
  needsAccount: boolean;
  /** Explicación para el usuario, en español. */
  note?: string;
}

/** Hosts de Baidu que sabemos distinguir. */
const HOSTS = {
  pan: /(^|\.)(pan|yun|eyun)\.baidu\.com$/i,
  tieba: /(^|\.)tieba\.baidu\.com$/i,
  wenku: /(^|\.)wenku\.baidu\.com$/i,
  baidu: /(^|\.)baidu\.com$/i,
};

/** Códigos de 4 caracteres que usa Baidu (letras y números, sin 0/o/1/l). */
const PWD_RE = /(?:^|[?&#]|提取码[:：\s]*|密码[:：\s]*|pwd[=:\s]+)([a-z0-9]{4})(?![a-z0-9])/i;

/**
 * Saca el `pwd` de un texto. Acepta:
 *  · `?pwd=abcd` o `#pwd=abcd` dentro del propio enlace
 *  · "提取码: abcd" / "密码：abcd" (el formato que copia la web china)
 */
export function extractPwd(texto: string): string | undefined {
  const m = texto.match(/[?&#]pwd=([a-z0-9]{4})/i);
  if (m) return m[1].toLowerCase();
  const m2 = texto.match(/(?:提取码|密码|访问码)[:：\s]*([a-z0-9]{4})/i);
  if (m2) return m2[1].toLowerCase();
  // último recurso: un `pwd` suelto al final ("链接: … 1234")
  const m3 = texto.match(PWD_RE);
  return m3 ? m3[1].toLowerCase() : undefined;
}

/** Quita el `?pwd=`/`#pwd=` de la URL para no pasárselo al motor como basura. */
export function stripPwd(url: string): string {
  return url.replace(/([?&#])pwd=[a-z0-9]{4}/i, "$1").replace(/[?&]$/, "").replace(/#$/, "");
}

/**
 * Analiza un enlace (o un texto pegado entero) de Baidu.
 * @returns null si no es de Baidu.
 */
export function parseBaidu(texto: string): BaiduInfo | null {
  const trozo = texto.match(/https?:\/\/[^\s"'<>）)】]+/i)?.[0] ?? texto.trim();
  let u: URL;
  try { u = new URL(trozo); } catch { return null; }
  const host = u.hostname;

  if (HOSTS.pan.test(host) || (HOSTS.baidu.test(host) && /^\/s\//.test(u.pathname))) {
    const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/);
    const surl = m?.[1];
    const pwd = extractPwd(texto) ?? extractPwd(u.search + u.hash);
    return {
      kind: "pan",
      url: stripPwd(trozo),
      surl,
      pwd,
      needsAccount: true,
      note: pwd
        ? "Enlace de 百度网盘 con código 提取码 detectado. Se transferirá a tu cuenta y se descargará desde ahí."
        : "Enlace de 百度网盘. Si el recurso tiene código (提取码), pégalo en el mismo texto: «提取码: abcd» o «?pwd=abcd».",
    };
  }

  if (HOSTS.tieba.test(host)) {
    const m = u.pathname.match(/\/p\/(\d+)/);
    return {
      kind: "tieba",
      url: trozo,
      surl: m?.[1],
      needsAccount: false,
      note: "Foro de 百度贴吧: las imágenes y vídeos de un hilo no tienen enlace directo; Baidu sirve las imágenes por un proxy con Referer.",
    };
  }

  if (HOSTS.wenku.test(host)) {
    return {
      kind: "wenku",
      url: trozo,
      needsAccount: true,
      note: "百度文库 renderiza el documento en lienzos (canvas) con texto ofuscado y exige VIP para descargar. No hay archivo que bajar: no se puede soportar de forma honesta.",
    };
  }

  if (HOSTS.baidu.test(host)) {
    return { kind: "other", url: trozo, needsAccount: false, note: "Enlace de Baidu no reconocido." };
  }
  return null;
}

/** ¿Es un enlace de Baidu? (atajo para el router) */
export function isBaidu(url: string): boolean {
  return parseBaidu(url) !== null;
}

/**
 * Argumentos de BaiduPCS-Go para transferir el recurso compartido a tu nube.
 * Sintaxis de la rama qjfoidnh/BaiduPCS-Go (v3.6+):
 *   BaiduPCS-Go transfer -p <pwd> -dir <ruta> <enlace>
 */
export function baidupcsTransferArgs(url: string, pwd?: string, dir = "/我的资源"): string[] {
  const a = ["transfer"];
  if (pwd) a.push("-p", pwd);
  if (dir) a.push("-dir", dir);
  a.push("--", url);
  return a;
}

/**
 * Argumentos para descargar desde tu nube a la carpeta local.
 *   BaiduPCS-Go download <ruta_remota> -saveto <carpeta_local>
 */
export function baidupcsDownloadArgs(remote: string, localDir: string): string[] {
  return ["download", remote, "-saveto", localDir, "--ow"];
}

/**
 * Saca la ruta remota del texto que imprime `transfer`.
 * BaiduPCS-Go responde cosas como:
 *   "转存成功, 保存了 1 个文件, 到 /我的资源/剧集 (12.3MB)"
 * Si la versión cambia el texto, no se inventa nada: se devuelve null y el
 * llamante usa el directorio configurado.
 */
export function parseTransferredPath(salida: string): string | null {
  const lineas = salida.split(/\r?\n/).reverse();
  for (const l of lineas) {
    // "到 /我的资源/xxx" o "到目录: /我的资源"
    const m = l.match(/(?:到|至|into)\s*[:：]?\s*(\/[^\s(（,，]+)/);
    if (m) return m[1].trim();
  }
  return null;
}
