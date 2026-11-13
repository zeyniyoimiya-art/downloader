"use client";
// "/cookies": gestor por sitio. Pegar/subir cookies.txt, estado y "probar sesión" con probe autenticado.
import { useEffect, useState } from "react";
import { ShieldCheck, Upload, FlaskConical, Trash2, Save, Loader2 } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Panel } from "@/components/ui";
import { sfx } from "@/lib/client/sound";

interface CookieState { site: string; present: boolean; updated: number | null; lines: number }
const META: Record<string, { name: string; color: string }> = { youtube: { name: "YouTube", color: "#ff3b30" }, instagram: { name: "Instagram", color: "#e1306c" }, x: { name: "X / Twitter", color: "#e5e5ea" }, tiktok: { name: "TikTok", color: "#25f4ee" } };

export default function Cookies() {
  const { toast } = useApp();
  const [list, setList] = useState<CookieState[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<Record<string, boolean | "busy">>({});
  const load = () => fetch("/api/cookies").then((r) => r.json()).then(setList);
  useEffect(() => { void load(); }, []);

  const save = async (site: string, content: string) => {
    sfx.pop();
    const r = await fetch("/api/cookies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site, content }) });
    const d = await r.json();
    if (!r.ok) return toast({ kind: "err", title: "No se guardó", body: d.error });
    toast({ kind: "ok", title: `Cookies de ${META[site].name} guardadas` }); setDraft((x) => ({ ...x, [site]: "" })); void load();
  };
  const test = async (site: string) => {
    sfx.pop(); setTested((x) => ({ ...x, [site]: "busy" }));
    const d = await (await fetch("/api/cookies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site }) })).json();
    setTested((x) => ({ ...x, [site]: d.ok })); toast({ kind: d.ok ? "ok" : "err", title: d.ok ? "Sesión válida" : "Sesión no válida", body: d.message });
  };
  const del = async (site: string) => { sfx.pop(); await fetch(`/api/cookies?site=${site}`, { method: "DELETE" }); setTested((x) => ({ ...x, [site]: false })); void load(); };

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-4xl font-bold tracking-[-0.035em]">Cookies</h1>
        <p className="muted mt-1 text-sm">Para contenido privado o con edad restringida. Formato Netscape <span className="mono">cookies.txt</span>.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((c, i) => {
          const t = tested[c.site];
          const state = !c.present ? "ausente" : t === true ? "probada" : "presente";
          return (
            <Panel key={c.site} tilt className="rise p-5" >
              <div className="flex items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="h-3 w-3 rounded-full" style={{ background: META[c.site].color, boxShadow: `0 0 12px ${META[c.site].color}` }} />
                <h2 className="font-semibold">{META[c.site].name}</h2>
                <span className={`mono ml-auto sq-pill px-2.5 py-0.5 text-[11px] ${state === "probada" ? "bg-emerald-500/20 text-emerald-300" : state === "presente" ? "bg-violet-500/20 text-violet-200" : "bg-white/10 muted"}`}>{state}</span>
              </div>
              {c.present && <p className="muted mono mt-2 text-[11px]">{c.lines} cookies · {new Date(c.updated!).toLocaleString()}</p>}
              <textarea value={draft[c.site] ?? ""} onChange={(e) => setDraft((x) => ({ ...x, [c.site]: e.target.value }))} rows={3} placeholder="# Netscape HTTP Cookie File…" aria-label={`Cookies de ${META[c.site].name}`} className="mono scrim mt-3 w-full resize-none border border-white/10 p-3 text-xs outline-none sq-sm" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={!draft[c.site]} onClick={() => save(c.site, draft[c.site])} className="btn btn-primary h-9 px-4 text-xs sq-pill"><Save size={14} />Guardar</button>
                <label className="btn btn-glass h-9 px-4 text-xs sq-pill"><Upload size={14} />Subir archivo
                  <input type="file" accept=".txt,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await save(c.site, await f.text()); }} />
                </label>
                <button disabled={!c.present || t === "busy"} onClick={() => test(c.site)} className="btn btn-glass h-9 px-4 text-xs sq-pill">{t === "busy" ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}Probar sesión</button>
                {c.present && <button onClick={() => del(c.site)} className="btn btn-glass h-9 w-9 sq-pill" aria-label="Borrar"><Trash2 size={14} /></button>}
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel className="flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 text-emerald-400" strokeWidth={1.5} />
        <p className="muted text-sm">Privacidad local: tus cookies se guardan con permisos 600 en la carpeta de datos de Linyue y solo las leen los motores de esta máquina. Nunca se envían a ningún servidor de Linyue (no existe).</p>
      </Panel>
    </div>
  );
}
