// Sonidos de UI sintetizados con Web Audio (sin archivos). pop = vidrio, success = campanita, error = thud.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) { muted = m; }
function ac(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return ctx;
}
function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slide?: number) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  pop: () => { tone(1400, 0.07, "sine", 0.05, 0, 700); haptic(8); },
  tick: () => tone(2200, 0.03, "triangle", 0.02),
  success: () => { tone(1318, 0.5, "sine", 0.05); tone(1976, 0.6, "sine", 0.035, 0.09); haptic([10, 40, 10]); },
  error: () => { tone(140, 0.25, "sine", 0.09, 0, 70); haptic(40); },
};
// Vibración háptica en móvil.
//
// Chrome lanza un aviso en consola («Blocked call to navigator.vibrate because
// user hasn't tapped…») si se pide sin interacción previa, y en escritorio no
// existe. Se comprueba antes: así la consola queda limpia y no se molesta al
// navegador con llamadas que va a rechazar igual.
export function haptic(p: number | number[]) {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    // `userActivation` no está en todos los navegadores; si no está, se prueba igual.
    const activacion = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activacion && !activacion.hasBeenActive) return;
    navigator.vibrate(p);
  } catch {}
}
