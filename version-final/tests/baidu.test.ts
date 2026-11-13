// Tests del adaptador de Baidu: enlaces, códigos 提取码 y los dos pasos de
// BaiduPCS-Go. Nada de red: todo es análisis de texto y construcción de argv.
import { describe, expect, it } from "vitest";
import {
  baidupcsDownloadArgs, baidupcsTransferArgs, extractPwd, isBaidu,
  parseBaidu, parseTransferredPath, stripPwd,
} from "../src/lib/shared/baidu";
import { detect, routeEngine, supportedModes } from "../src/lib/shared/platforms";

describe("detección de enlaces de Baidu", () => {
  it("reconoce 百度网盘 en todas sus formas", () => {
    for (const u of [
      "https://pan.baidu.com/s/1AbCdEfGh",
      "https://yun.baidu.com/s/1AbCdEfGh",
      "https://eyun.baidu.com/s/1AbCdEfGh",
      "https://baidu.com/s/1AbCdEfGh",
    ]) {
      const b = parseBaidu(u);
      expect(b?.kind).toBe("pan");
      expect(b?.surl).toBe("1AbCdEfGh");
      expect(b?.needsAccount).toBe(true);
    }
  });

  it("no confunde otros sitios con Baidu", () => {
    expect(parseBaidu("https://www.youtube.com/watch?v=1")).toBeNull();
    expect(isBaidu("https://mega.nz/file/abc")).toBe(false);
  });

  it("separa el 提取码 del enlace (?pwd= y #pwd=)", () => {
    const b = parseBaidu("https://pan.baidu.com/s/1AbCdEf?pwd=x7k2");
    expect(b?.pwd).toBe("x7k2");
    expect(b?.url).toBe("https://pan.baidu.com/s/1AbCdEf");
    expect(stripPwd("https://pan.baidu.com/s/1A?pwd=x7k2")).toBe("https://pan.baidu.com/s/1A");
  });

  it("entiende el texto chino que copia la web", () => {
    const pegado = "链接: https://pan.baidu.com/s/1AbCdEf 提取码: 9z3q 复制这段内容后打开百度网盘手机App";
    const b = parseBaidu(pegado);
    expect(b?.pwd).toBe("9z3q");
    expect(b?.url).toBe("https://pan.baidu.com/s/1AbCdEf");
    expect(extractPwd("密码：ab12")).toBe("ab12");
    expect(extractPwd("https://pan.baidu.com/s/1A?pwd=Q1w2")).toBe("q1w2");
    expect(extractPwd("sin codigo")).toBeUndefined();
  });

  it("Tieba y Wenku se identifican aparte (Wenku no es descargable)", () => {
    expect(parseBaidu("https://tieba.baidu.com/p/123456789")?.kind).toBe("tieba");
    const w = parseBaidu("https://wenku.baidu.com/view/abc123.html");
    expect(w?.kind).toBe("wenku");
    expect(w?.needsAccount).toBe(true);
    expect(w?.note).toMatch(/canvas|VIP/i);
  });
});

describe("router: Baidu va a su propio motor", () => {
  it("pan → baidupcs, tieba → gallerydl, wenku no admite modos", () => {
    const pan = detect("https://pan.baidu.com/s/1AbCdEf")!;
    expect(pan.platform).toBe("baidu-pan");
    expect(routeEngine(pan, "video")).toBe("baidupcs");
    expect(supportedModes(pan)).toEqual(["video", "audio", "photo"]);

    const tieba = detect("https://tieba.baidu.com/p/123456789")!;
    expect(routeEngine(tieba, "photo")).toBe("gallerydl");

    const wenku = detect("https://wenku.baidu.com/view/abc.html")!;
    expect(supportedModes(wenku)).toEqual([]);
  });
});

describe("dos pasos de BaiduPCS-Go", () => {
  it("transfer lleva el código y el destino, y aísla la URL con --", () => {
    const a = baidupcsTransferArgs("https://pan.baidu.com/s/1AbC", "x7k2", "/我的资源");
    expect(a[0]).toBe("transfer");
    expect(a.join(" ")).toContain("-p x7k2");
    expect(a.join(" ")).toContain("-dir /我的资源");
    expect(a[a.length - 2]).toBe("--");
  });

  it("sin código no se inventa un -p vacío", () => {
    const a = baidupcsTransferArgs("https://pan.baidu.com/s/1AbC");
    expect(a).not.toContain("-p");
  });

  it("download apunta a la carpeta local con -saveto", () => {
    const a = baidupcsDownloadArgs("/我的资源/serie", "D:\\Descargas");
    expect(a).toEqual(["download", "/我的资源/serie", "-saveto", "D:\\Descargas", "--ow"]);
  });

  it("lee la ruta que imprime la transferencia en chino", () => {
    const salida = "2026/11/13 10:22:01\n转存成功, 保存了 1 个文件, 到 /我的资源/剧集 (1.2GB)\n";
    expect(parseTransferredPath(salida)).toBe("/我的资源/剧集");
    expect(parseTransferredPath("no hay ruta aquí")).toBeNull();
  });
});
