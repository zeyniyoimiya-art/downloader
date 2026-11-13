// Parseo de la salida de los motores: porcentaje, velocidad, ETA y archivo final.

export interface Progress {
  percent?: number;
  speed?: number; // bytes/s
  eta?: string;
  file?: string;
}

const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, KB: 1e3, MB: 1e6, GB: 1e9, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

export function toBytes(n: string, unit: string): number {
  return parseFloat(n) * (UNITS[unit] ?? 1);
}

export function parseLine(line: string): Progress | null {
  // yt-dlp: [download]  45.3% of ~10.00MiB at  2.50MiB/s ETA 00:04
  let m = line.match(/\[download\]\s+([\d.]+)%(?:.*?at\s+([\d.]+)\s*([KMG]?i?B)\/s)?(?:.*?ETA\s+([\d:]+|Unknown))?/);
  if (m) {
    const p: Progress = { percent: Math.min(100, parseFloat(m[1])) };
    if (m[2]) p.speed = toBytes(m[2], m[3]);
    if (m[4] && m[4] !== "Unknown") p.eta = m[4];
    return p;
  }
  // aria2c: [#2089b0 400.0KiB/33.2MiB(1%) CN:1 DL:115.7KiB ETA:4m51s]
  m = line.match(/\((\d+)%\).*?DL:([\d.]+)([KMG]?i?B)(?:.*?ETA:(\w+))?/);
  if (m) return { percent: +m[1], speed: toBytes(m[2], m[3]), eta: m[4] };
  // marcador propio emitido con --print
  m = line.match(/^LYF\|(.+)$/);
  if (m) return { file: m[1].trim() };
  // spotdl / genérico: "  57%" o "Downloaded "x": url"
  m = line.match(/(\d{1,3})%\|/);
  if (m) return { percent: Math.min(100, +m[1]) };
  return null;
}

export function fmtBytes(b: number): string {
  if (!b || b < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDuration(s: number): string {
  if (!s || s < 0) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtViews(n: number): string {
  if (!n || n < 0) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
