// Control de ritmo por host: token bucket + enfriamiento ante 429/403.
//
// ── POR QUÉ HACE FALTA ───────────────────────────────────────────────────────
// Con concurrencia alta, 20 trabajos del MISMO sitio salen a la vez y el CDN
// responde 429 ("Too Many Requests"), 403 o el clásico "Sign in to confirm
// you're not a bot". Reintentar los 20 a la vez empeora el castigo: la IP queda
// marcada minutos. Lo que funciona es que, cuando UNO recibe 429, todos los
// demás de ese host ESPEREN un tiempo creciente (backoff compartido), y que el
// resto de hosts sigan a toda velocidad.
//
// El estado vive en memoria del proceso y es por host: no hay límite global
// artificial salvo el que impone el sistema (ver limits.ts en jobs).

export type LimitKind = "ok" | "wait" | "cooldown";

interface HostState {
  /** Tokens disponibles (peticiones que pueden empezar ya). */
  tokens: number;
  /** Última recarga del bucket. */
  refilledAt: number;
  /** Hasta cuándo está penalizado el host (epoch ms). */
  blockedUntil: number;
  /** Fallos consecutivos por límite de tasa. */
  strikes: number;
  /** Última vez que se penalizó, para el backoff exponencial. */
  lastStrikeAt: number;
}

export interface HostLimiterOptions {
  /** Peticiones por minuto permitidas por host (0 = sin límite). */
  perMinute?: number;
  /** Tope de la espera por backoff (ms). */
  maxCooldownMs?: number;
  /** Ventana para considerar que dos strikes son del mismo episodio. */
  strikeWindowMs?: number;
}

const DEFAULT_OPTS: Required<HostLimiterOptions> = {
  perMinute: 0,
  maxCooldownMs: 5 * 60_000,
  strikeWindowMs: 10 * 60_000,
};

/** Extrae el host "de castigo" de una URL (subdominios comparten bucket). */
export function hostKey(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    // googlevideo.com / *.googlevideo.com → mismo bucket
    return h.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return "";
  }
}

export class HostLimiter {
  private hosts = new Map<string, HostState>();
  private opts: Required<HostLimiterOptions>;

  constructor(opts: HostLimiterOptions = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  setPerMinute(n: number) {
    this.opts.perMinute = Math.max(0, Math.floor(n));
  }

  private state(host: string, now = Date.now()): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      // Arranca con el bucket lleno: la primera ráfaga no debe esperar.
      s = { tokens: Math.max(1, this.opts.perMinute), refilledAt: now, blockedUntil: 0, strikes: 0, lastStrikeAt: 0 };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** ¿Puede arrancar ahora un trabajo de este host? */
  check(url: string, now = Date.now()): { kind: LimitKind; waitMs: number; reason?: string } {
    const host = hostKey(url);
    if (!host) return { kind: "ok", waitMs: 0 };
    const s = this.state(host, now);
    if (s.blockedUntil > now) {
      return { kind: "cooldown", waitMs: s.blockedUntil - now, reason: `esperando ${Math.ceil((s.blockedUntil - now) / 1000)} s por límite de ${host}` };
    }
    if (this.opts.perMinute > 0) {
      // Recarga proporcional al tiempo transcurrido.
      const rate = this.opts.perMinute / 60_000; // tokens por ms
      const gained = (now - s.refilledAt) * rate;
      s.tokens = Math.min(this.opts.perMinute, s.tokens + gained);
      s.refilledAt = now;
      if (s.tokens < 1) return { kind: "wait", waitMs: Math.ceil((1 - s.tokens) / rate), reason: `ritmo de ${this.opts.perMinute}/min en ${host}` };
      s.tokens -= 1;

    }
    return { kind: "ok", waitMs: 0 };
  }

  /**
   * El motor se topó con un límite de tasa. Devuelve los ms de castigo aplicados.
   * Backoff: 30 s → 60 s → 120 s → 240 s → 300 s (tope). Se reinicia si entre
   * strikes pasa más de `strikeWindowMs` (episodio nuevo).
   */
  penalize(url: string, now = Date.now(), hintMs = 0): number {
    const host = hostKey(url);
    if (!host) return 0;
    const s = this.state(host, now);
    if (now - s.lastStrikeAt > this.opts.strikeWindowMs) s.strikes = 0;
    s.strikes += 1;
    s.lastStrikeAt = now;
    const backoff = Math.min(this.opts.maxCooldownMs, 30_000 * 2 ** (s.strikes - 1));
    const ban = Math.max(hintMs, backoff);
    s.blockedUntil = Math.max(s.blockedUntil, now + ban);
    return ban;
  }

  /** ¿Este texto de error huele a rate limit / bloqueo anti-bot? */
  static isRateLimit(text: string): boolean {
    return /429|too many requests|rate.?limit|sign in to confirm|not a bot|403 forbidden|access denied|temporarily blocked|try again later|http error 403|http error 429/i.test(text);
  }

  /** Milisegundos de un "Retry-After" si el motor lo imprime. */
  static retryAfterMs(text: string): number {
    const m = text.match(/retry[- ]after[:\s]+(\d+)/i);
    if (m) return Math.min(300_000, Number(m[1]) * 1000);
    const s = text.match(/try again in (\d+)\s*(seconds?|secs?|minutes?|mins?)/i);
    if (s) return Math.min(300_000, Number(s[1]) * (/min/i.test(s[2]) ? 60_000 : 1000));
    return 0;
  }

  snapshot(): { host: string; waitMs: number; strikes: number }[] {
    const now = Date.now();
    return [...this.hosts.entries()]
      .filter(([, s]) => s.blockedUntil > now)
      .map(([host, s]) => ({ host, waitMs: s.blockedUntil - now, strikes: s.strikes }))
      .sort((a, b) => b.waitMs - a.waitMs);
  }

  clear() {
    this.hosts.clear();
  }
}

/** Jitter para no arrancar N trabajos en el mismo milisegundo. */
export function jitter(maxMs = 900): number {
  return Math.floor(Math.random() * maxMs);
}
