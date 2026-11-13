// Tipos compartidos por la UI (espejo de las respuestas de la API)
import type { Mode } from "@/lib/shared/platforms";
export type { Mode };
export interface JobView {
  id: string; url: string; platform: string; label: string; mode: Mode; format: string; quality: string; engine: string;
  state: "queued" | "probing" | "running" | "post" | "paused" | "done" | "error" | "canceled" | "skipped";
  percent: number; speed: number; eta: string; title: string; thumbnail: string; files: string[]; log: string[]; error?: string;
  /** Terminó sin archivos: aviso suave (no es un error duro) */
  warning?: string;
}
export interface EngineView { id: string; exe: string; role: string; optional: boolean; path: string | null; version: string | null; health: "ok" | "warn" | "down"; note: string }
export interface HistoryView { id: string; url: string; title: string; author: string; date: string; source: string; format: string; size: number; duration: number; path: string; thumbnail: string; engine: string; mode: string; createdAt: number }
export interface ConfigView {
  outputDir: string; vendorDir: string; enginePaths: Record<string, string>; audioFormat: string; videoFormat: string; videoQuality: string;
  photoFormat: string; concurrency: number; turbo: boolean; noRepeat: boolean; profileLimit: number; altEngineCN: boolean;
}
