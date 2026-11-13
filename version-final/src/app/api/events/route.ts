// Progreso en vivo por SSE (EventSource), cero dependencias
import { bus, listJobs } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (ev: string, data: unknown) => {
        try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      const onJobs = (j: unknown) => send("jobs", j);
      const onEvent = (e: { type: string; data: unknown }) => send(e.type, e.data);
      bus.on("jobs", onJobs);
      bus.on("event", onEvent);
      // El latido va protegido: si el cliente cerró la pestaña entre el abort y
      // el clearInterval, `enqueue` lanza dentro del timer y eso es una
      // excepción NO capturada que tumba el manejador de la ruta.
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(`: ping\n\n`)); } catch { clearInterval(ping); } }, 15000);
      send("jobs", listJobs());
      cleanup = () => { clearInterval(ping); bus.off("jobs", onJobs); bus.off("event", onEvent); };
      req.signal.addEventListener("abort", () => { cleanup(); try { ctrl.close(); } catch {} });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
