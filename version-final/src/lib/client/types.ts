// Tipos compartidos por la UI (espejo de las respuestas de la API)
import type { Mode } from "@/lib/shared/platforms";
export type { Mode };
export interface JobView {
  id: string; url: string; platform: string; label: string; mode: Mode; format: string; quality: string; engine: string;
  state: "queued" | "probing" | "running" | "post" | "paused" | "done" | "error" | "canceled" | "skipped";
  percent: number; speed: number; eta: string; title: string; thumbnail: string; files: string[]; log: string[]; error?: string;
  /** Terminó sin archivos: aviso suave (no es un error duro) */
  warning?: string;
  /** Programado: instante (ms) en el que puede arrancar (fase 8). */
  startAt?: number;
}
export interface EngineView { id: string; exe: string; role: string; optional: boolean; path: string | null; version: string | null; health: "ok" | "warn" | "down"; note: string }
export interface HistoryView { id: string; url: string; title: string; author: string; date: string; source: string; format: string; size: number; duration: number; path: string; thumbnail: string; engine: string; mode: string; createdAt: number }
export interface ConfigView {
  outputDir: string; vendorDir: string; enginePaths: Record<string, string>; audioFormat: string; videoFormat: string; videoQuality: string;
  photoFormat: string; concurrency: number; maxConcurrency: number; turbo: boolean; noRepeat: boolean; profileLimit: number; altEngineCN: boolean;
  fidelity: "estricto" | "avisar" | "libre"; cookiesFromBrowser: string; impersonate: string; limitRate: string;
  retries: number; sleepRequests: number; ratePerMinute: number; probeConcurrency: number; audioQuality: string;
  videoCodec: "auto" | "h264" | "h265" | "av1" | "vp9" | "vp8" | "mpeg4" | "prores" | "theora";
  subtitles: "off" | "sidecar" | "embed"; subLangs: string; autoSubs: boolean;
  chapters: boolean; embedThumbnail: boolean; keepOriginal: boolean; reencodeVideo: boolean; baiduDir: string;
  proxy: string; playlistRange: string; naming: "ordenado" | "compacto" | "plano" | "fecha"; abortOnDiskFull: boolean;
  quietEnabled: boolean; quietFrom: string; quietTo: string;
  sponsorblock: "off" | "marcar" | "quitar"; sections: string; splitChapters: boolean;
  notify: boolean; apagarAlTerminar: boolean; subsEnabled: boolean; subsEveryHours: number;
}
