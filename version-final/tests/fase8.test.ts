// Fase 8: programador (ventana silenciosa + retraso), estadísticas y 蓝奏云.
//
// Nada de red real: la cadena de Lanzou se prueba con fixtures de HTML/JSON
// sacados de páginas de ejemplo, que es lo único honesto que se puede hacer sin
// depender de un servidor chino que cambia cada pocos meses.
import { describe, it, expect } from "vitest";
import {
  aMinutos,
  minutosDelDia,
  enVentanaSilenciosa,
  cruzaMedianoche,
  msHastaApertura,
  describirVentana,
  puedeArrancar,
} from "../src/lib/shared/schedule";
import { calcularEstadisticas, diaLocal, type ItemHistorial } from "../src/lib/shared/stats";
import {
  esLanzou,
  extraerIframe,
  extraerFirma,
  interpretarAjaxm,
  nombreSeguro,
} from "../src/lib/server/lanzou";
import { detect, routeEngine, supportedModes } from "../src/lib/shared/platforms";
import { ENGINES } from "../src/lib/server/engines";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("programador · horas", () => {
  it("convierte HH:MM a minutos desde medianoche", () => {
    expect(aMinutos("00:00")).toBe(0);
    expect(aMinutos("07:30")).toBe(450);
    expect(aMinutos("7:05")).toBe(425);
    expect(aMinutos("23:59")).toBe(1439);
  });

  it("rechaza horas imposibles en vez de inventarse una", () => {
    for (const malo of ["", "24:00", "12:60", "-1:00", "abc", "12", "12:5"]) {
      expect(aMinutos(malo), malo).toBeNull();
    }
  });

  it("minutosDelDia usa la hora LOCAL del equipo", () => {
    const ms = local(2026, 3, 14, 9, 45);
    expect(minutosDelDia(ms)).toBe(9 * 60 + 45);
  });
});

describe("programador · ventana silenciosa", () => {
  it("ventana normal (01:00 → 07:00)", () => {
    expect(enVentanaSilenciosa("01:00", "07:00", local(2026, 3, 14, 1, 0))).toBe(true);
    expect(enVentanaSilenciosa("01:00", "07:00", local(2026, 3, 14, 6, 59))).toBe(true);
    expect(enVentanaSilenciosa("01:00", "07:00", local(2026, 3, 14, 7, 0))).toBe(false); // fin exclusivo
    expect(enVentanaSilenciosa("01:00", "07:00", local(2026, 3, 14, 0, 59))).toBe(false);
    expect(enVentanaSilenciosa("01:00", "07:00", local(2026, 3, 14, 15, 0))).toBe(false);
  });

  it("ventana que CRUZA la medianoche (22:00 → 07:00)", () => {
    const v = (h: number, m = 0) => enVentanaSilenciosa("22:00", "07:00", local(2026, 3, 14, h, m));
    expect(v(22, 0)).toBe(true);
    expect(v(23, 59)).toBe(true);
    expect(v(0, 0)).toBe(true);
    expect(v(3, 30)).toBe(true);
    expect(v(6, 59)).toBe(true);
    expect(v(7, 0)).toBe(false);
    expect(v(12, 0)).toBe(false);
    expect(v(21, 59)).toBe(false);
  });

  it("una ventana inválida o vacía no bloquea nada", () => {
    expect(enVentanaSilenciosa("nada", "07:00")).toBe(false);
    expect(enVentanaSilenciosa("03:00", "03:00")).toBe(false);
  });

  it("detecta y describe el cruce de medianoche", () => {
    expect(cruzaMedianoche("22:00", "07:00")).toBe(true);
    expect(cruzaMedianoche("01:00", "07:00")).toBe(false);
    expect(describirVentana("22:00", "07:00")).toContain("cruza medianoche");
    expect(describirVentana("01:00", "07:00")).toBe("01:00–07:00");
  });

  it("calcula cuánto falta para que abra, sin quedarse en 0", () => {
    const dentro = local(2026, 3, 14, 3, 0);
    const espera = msHastaApertura("01:00", "07:00", dentro);
    expect(espera).toBe(4 * 3600_000); // 03:00 → 07:00
    expect(msHastaApertura("01:00", "07:00", local(2026, 3, 14, 12, 0))).toBe(0); // ya abierta
    // cruzando medianoche: a las 23:00 faltan 8 h para las 07:00 del día siguiente
    expect(msHastaApertura("22:00", "07:00", local(2026, 3, 14, 23, 0))).toBe(8 * 3600_000);
  });

  it("un trabajo sin hora arranca ya; con hora futura, no", () => {
    const ahora = local(2026, 3, 14, 12, 0);
    expect(puedeArrancar(undefined, ahora)).toBe(true);
    expect(puedeArrancar(0, ahora)).toBe(true);
    expect(puedeArrancar(ahora + 60_000, ahora)).toBe(false);
    expect(puedeArrancar(ahora - 1, ahora)).toBe(true);
  });
});

describe("estadísticas", () => {
  const ahora = local(2026, 11, 12, 18, 0);
  const item = (p: Partial<ItemHistorial>): ItemHistorial => ({
    source: "YouTube", format: "MP4 (vídeo)", size: 1000, duration: 60,
    engine: "yt-dlp", mode: "video", author: "Canal A", createdAt: ahora, ...p,
  });
  const items: ItemHistorial[] = [
    item({ size: 3000, author: "Canal A" }),
    item({ size: 2000, source: "Bilibili", author: "Canal B", format: "FLAC" }),
    item({ size: 1000, createdAt: local(2026, 11, 11, 10), author: undefined }),
    item({ size: 500, createdAt: local(2026, 11, 9, 10), engine: "gallery-dl", mode: "image", format: "JPG" }),
    item({ size: 0, duration: 0, createdAt: 0 }), // basura: sin fecha, se ignora
  ];

  it("suma totales e ignora registros sin fecha", () => {
    const e = calcularEstadisticas(items, ahora);
    expect(e.total.archivos).toBe(4);
    expect(e.total.bytes).toBe(6500);
    expect(e.total.segundos).toBe(240);
    expect(e.total.plataformas).toBe(2);
    expect(e.mediaBytes).toBe(1625);
    expect(e.mayorBytes).toBe(3000);
  });

  it("agrupa por plataforma, formato y motor ordenando por bytes", () => {
    const e = calcularEstadisticas(items, ahora);
    expect(e.porPlataforma[0]).toMatchObject({ clave: "YouTube", archivos: 3, bytes: 4500 });
    expect(e.porFormato.map((c) => c.clave)).toEqual(["MP4", "FLAC", "JPG"]);
    expect(e.porMotor.find((c) => c.clave === "gallery-dl")?.bytes).toBe(500);
  });

  it("el formato no se duplica por mayúsculas («MP3» y «mp3» son el mismo)", () => {
    const e = calcularEstadisticas([item({ format: "MP3", size: 10 }), item({ format: "mp3", size: 20 })], ahora);
    expect(e.porFormato).toHaveLength(1);
    expect(e.porFormato[0]).toMatchObject({ clave: "MP3", archivos: 2, bytes: 30 });
  });

  it("top de autores sin huecos y con límite", () => {
    const e = calcularEstadisticas(items, ahora);
    expect(e.topAutores.map((c) => c.clave)).toEqual(["Canal A", "Canal B"]);
    expect(e.topAutores.every((c) => c.clave !== "—")).toBe(true);
  });

  it("la serie por día trae SIEMPRE los cubos, también vacíos", () => {
    const e = calcularEstadisticas(items, ahora, 5);
    expect(e.porDia).toHaveLength(5);
    expect(e.porDia.at(-1)?.dia).toBe("2026-11-12");
    expect(e.porDia.at(-1)?.bytes).toBe(3000 + 2000);
    expect(e.porDia.at(-2)?.bytes).toBe(1000);
    const vacios = e.porDia.filter((d) => d.archivos === 0);
    expect(vacios).toHaveLength(2); // 10 y 8 de noviembre
  });

  it("los días son LOCALES: una descarga de las 22:00 cuenta en su día", () => {
    const e = calcularEstadisticas([item({ createdAt: local(2026, 11, 12, 22, 30), size: 7 })], ahora, 3);
    expect(e.porDia.at(-1)?.bytes).toBe(7);
  });

  it("racha: cuenta días seguidos y el día de hoy sin actividad no la rompe", () => {
    const dias = (ns: number[]) => ns.map((d) => item({ createdAt: local(2026, 11, d, 9), size: 1 }));
    expect(calcularEstadisticas(dias([12, 11, 10]), ahora).rachaDias).toBe(3);
    expect(calcularEstadisticas(dias([11, 10]), ahora).rachaDias).toBe(2); // hoy sin nada
    expect(calcularEstadisticas(dias([12, 10]), ahora).rachaDias).toBe(1); // hueco ayer
    expect(calcularEstadisticas(dias([9]), ahora).rachaDias).toBe(0);
  });

  it("historial vacío no rompe nada", () => {
    const e = calcularEstadisticas([], ahora, 3);
    expect(e.total).toEqual({ archivos: 0, bytes: 0, segundos: 0, plataformas: 0 });
    expect(e.mediaBytes).toBe(0);
    expect(e.mayorBytes).toBe(0);
    expect(e.rachaDias).toBe(0);
    expect(e.desde).toBeNull();
    expect(e.porDia).toHaveLength(3);
  });

  it("diaLocal rellena con ceros", () => {
    expect(diaLocal(local(2026, 1, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("蓝奏云 · extractor nativo", () => {
  it("reconoce los dominios de Lanzou y sus espejos", () => {
    for (const u of [
      "https://wwa.lanzouo.com/iAbCd123",
      "https://lanzoui.com/ibbb",
      "https://lanzoux.com/i1",
      "https://www.lanzn.com/xyz",
      "https://lanzoup.com/abc",
      "https://ww1.lanzoue.com/iQQ",
    ]) expect(esLanzou(u), u).toBe(true);
    for (const u of ["https://youtube.com/watch?v=1", "https://lanzou.example.com/x", "no es url"]) {
      expect(esLanzou(u), u).toBe(false);
    }
  });

  it("saca el iframe de la página", () => {
    const html = `<div><iframe class="n_downlink" src="/fn?3k9x2" scrolling="no" frameborder="0"></iframe></div>`;
    expect(extraerIframe(html)).toBe("/fn?3k9x2");
    expect(extraerIframe("<p>sin iframe</p>")).toBeNull();
  });

  it("saca sign/file/p del iframe, con o sin contraseña", () => {
    const conPwd = `<script>var data = {'action':'downprocess','sign':'a1b2c3','ves':1,'websign':'','websignkey':'','p':'x7k2'};
      $.ajax({url:'ajaxm.php?file=998877', ...});</script>`;
    expect(extraerFirma(conPwd)).toEqual({ sign: "a1b2c3", file: "998877", p: "x7k2" });

    const sinPwd = `data : {'action':'downprocess','sign':'zz99','ves':1,'p':''},
      ajaxm.php?file=554433&sign=zz99`;
    expect(extraerFirma(sinPwd)).toMatchObject({ sign: "zz99", file: "554433" });

    expect(extraerFirma("<html>Lanzou cambió el formato</html>")).toBeNull();
  });

  it("interpreta ajaxm.php: zt=1, dom sin esquema y url escapada", () => {
    const ok = interpretarAjaxm(
      JSON.stringify({ zt: 1, dom: "vip-lanzou.cdn.com", url: "\\/file\\/abc.zip?x=1", inf: "pack.zip" }),
      "https://wwa.lanzouo.com/iAbCd123",
    );
    expect(ok).toEqual({ url: "https://vip-lanzou.cdn.com/file/abc.zip?x=1", nombre: "pack.zip" });

    // dom ausente → se usa el origen de la página
    const sinDom = interpretarAjaxm(JSON.stringify({ zt: "1", url: "/d/f.zip" }), "https://wwa.lanzouo.com/i1");
    expect(sinDom?.url).toBe("https://wwa.lanzouo.com/d/f.zip");
  });

  it("falla cerrado cuando el servidor dice que no", () => {
    expect(interpretarAjaxm(JSON.stringify({ zt: 0, dom: "", url: "" }), "https://x.com")).toBeNull();
    expect(interpretarAjaxm(JSON.stringify({ zt: 1, url: "" }), "https://x.com")).toBeNull();
    expect(interpretarAjaxm("no es json", "https://x.com")).toBeNull();
  });

  it("nombreSeguro limpia lo que Windows prohíbe", () => {
    expect(nombreSeguro('a/b\\c:d*e?f"g<h>i|j.mp3')).toBe("a_b_c_d_e_f_g_h_i_j.mp3");
    expect(nombreSeguro("  línea\ncon salto  ")).toBe("línea con salto");
    expect(nombreSeguro("")).toBe("archivo");
    expect(nombreSeguro("***")).toBe("___");
    expect(nombreSeguro("x".repeat(400))).toHaveLength(150);
  });
});

describe("registro de plataformas y motores (fase 8)", () => {
  it("蓝奏云 y 阿里云盘 se detectan y enrutan a su motor", () => {
    const lanzou = detect("https://wwa.lanzouo.com/iAbCd123")!;
    const aliyun = detect("https://www.aliyundrive.com/s/abc")!;
    expect(lanzou.platform).toBe("lanzou");
    expect(aliyun.platform).toBe("aliyun-pan");
    expect(routeEngine(lanzou, "video")).toBe("lanzou");
    expect(routeEngine(aliyun, "video", { altEngineCN: true })).toBe("aliyunpan");
    expect(supportedModes(lanzou)).toContain("audio");
  });

  it("el motor 阿里云盘 está registrado con su binario", () => {
    const m = ENGINES.find((e) => e.id === "aliyunpan");
    expect(m?.bin).toContain("aliyunpan");
    expect(ENGINES.filter((e) => e.id === "aliyunpan")).toHaveLength(1);
  });
});
