// Etiquetas: de lo que el sitio sabe a lo que el archivo guarda.
//
// Todo es puro (sin red y sin binarios), así que se puede probar entero. Lo que
// se comprueba aquí es justo lo que se rompe en silencio: un título de YouTube
// con "(Official Video)" que acaba como nombre de canción, una carátula de 300
// px cuando había una de 1280, o un `date` que el muxer de MKV tira a la basura.
import { describe, expect, it } from "vitest";
import {
  admiteEtiquetas, argsDeEtiquetas, camposAplicables, etiquetasDeSonda, familiaDe, fechaISO,
  fusionar, hayEtiquetas, limpiar, mejorPortada, pareceMusica, quitarRuido, separarTitulo,
  soporteCaratula, type Etiquetas,
} from "@/lib/shared/etiquetas";

describe("separarTitulo", () => {
  it("saca artista y canción de un título de YouTube real", () => {
    expect(separarTitulo("Rick Astley - Never Gonna Give You Up (Official Video)"))
      .toEqual({ artista: "Rick Astley", cancion: "Never Gonna Give You Up" });
  });

  it("entiende los guiones largos y las barras que usan los canales de música", () => {
    expect(separarTitulo("DJ铁柱 – 刀群舞").artista).toBe("DJ铁柱");
    expect(separarTitulo("Aimer — 残響散歌").artista).toBe("Aimer");
    expect(separarTitulo("Queen // Bohemian Rhapsody").artista).toBe("Queen");
  });

  it("no inventa un artista cuando no lo hay claro", () => {
    expect(separarTitulo("Never Gonna Give You Up")).toEqual({ cancion: "Never Gonna Give You Up" });
    // Lado izquierdo larguísimo: es un título, no un artista.
    const frase = "Como hacer una tarta de chocolate paso a paso - tutorial completo";
    expect(separarTitulo(frase).artista).toBeUndefined();
  });

  it("quita el ruido entre paréntesis y corchetes", () => {
    expect(quitarRuido("Canción (Official Audio)")).toBe("Canción");
    expect(quitarRuido("Canción [MV]")).toBe("Canción");
    expect(quitarRuido("Canción (Lyric Video) [HD]")).toBe("Canción");
    // Lo que SÍ cambia el contenido del audio no se toca.
    expect(quitarRuido("Canción (Live at Wembley)")).toBe("Canción (Live at Wembley)");
  });
});

describe("fechaISO", () => {
  it("convierte el formato de yt-dlp a ISO", () => {
    expect(fechaISO("20261112")).toBe("2026-11-12");
    expect(fechaISO("19871112")).toBe("1987-11-12");
  });
  it("respeta lo que ya es una fecha o un año", () => {
    expect(fechaISO("2026-11-12T00:00:00Z")).toBe("2026-11-12");
    expect(fechaISO(1987)).toBe("1987");
  });
  it("no inventa nada con basura", () => {
    expect(fechaISO("")).toBe("");
    expect(fechaISO("ayer")).toBe("");
    expect(fechaISO(undefined)).toBe("");
  });
});

describe("limpiar", () => {
  it("quita NUL, espacios de ancho cero y espacios dobles", () => {
    expect(limpiar("Título\u0000con\u200b basura")).toBe("Título con basura");
  });
  it("corta por longitud para que no acabe en un argumento gigante", () => {
    expect(limpiar("x".repeat(5000), 10)).toHaveLength(10);
  });
});

describe("mejorPortada", () => {
  it("elige la de mayor área, no la primera de la lista", () => {
    const j = {
      thumbnails: [
        { url: "https://i.ytimg.com/a.jpg", width: 168, height: 94 },
        { url: "https://i.ytimg.com/b.jpg", width: 1280, height: 720 },
        { url: "https://i.ytimg.com/c.webp", width: 336, height: 188 },
      ],
    };
    expect(mejorPortada(j)?.url).toBe("https://i.ytimg.com/b.jpg");
  });

  it("descarta los sprites de storyboard (son rejillas, no carátulas)", () => {
    const j = { thumbnails: [{ url: "https://i.ytimg.com/sb/xyz/storyboard3_L2/M0.jpg", width: 160, height: 90 }, { url: "https://i.ytimg.com/vi/abc/maxresdefault.jpg", width: 1280, height: 720 }] };
    expect(mejorPortada(j)?.url).toContain("maxresdefault");
  });

  it("a igual tamaño prefiere JPG/PNG antes que WebP", () => {
    const j = { thumbnails: [{ url: "https://x/cover.webp", width: 640, height: 640 }, { url: "https://x/cover.jpg", width: 640, height: 640 }] };
    expect(mejorPortada(j)?.ext).toBe("jpg");
  });

  it("usa la miniatura suelta si no hay lista", () => {
    expect(mejorPortada({ thumbnail: "https://x/a.jpg", thumbnail_width: 300 })?.url).toBe("https://x/a.jpg");
    expect(mejorPortada({})).toBeNull();
  });
});

describe("etiquetasDeSonda", () => {
  it("limpia el canal «- Topic» y deduce artista del título", () => {
    const t = etiquetasDeSonda({
      title: "Rick Astley - Never Gonna Give You Up (Official Video)",
      uploader: "Rick Astley - Topic",
      upload_date: "20091025",
      webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(t.titulo).toBe("Never Gonna Give You Up");
    expect(t.artista).toBe("Rick Astley");
    expect(t.fecha).toBe("2009-10-25");
    expect(t.comentario).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("usa los campos de tienda cuando el sitio los da (SoundCloud/Bandcamp)", () => {
    const t = etiquetasDeSonda({
      title: "lo que sea", track: "Real Song", artist: "Real Artist",
      album: "Real Album", genre: "Synthwave", release_year: 2019,
      track_number: 3, disc_number: 1, isrc: "USRC17607839",
    });
    expect(t).toMatchObject({ titulo: "Real Song", artista: "Real Artist", album: "Real Album", genero: "Synthwave", fecha: "2019", pista: "3", disco: "1", isrc: "USRC17607839" });
  });

  it("no deja campos vacíos colgando (undefined, no cadenas vacías)", () => {
    const t = etiquetasDeSonda({ title: "Solo un título" });
    expect(t.album).toBeUndefined();
    expect(t.genero).toBeUndefined();
    expect(t.isrc).toBeUndefined();
  });

  it("aguanta basura sin lanzar", () => {
    for (const basura of [undefined, null, {}, "x", 42]) expect(() => etiquetasDeSonda(basura)).not.toThrow();
  });
});

describe("pareceMusica", () => {
  it("reconoce un track de tienda y un canal - Topic", () => {
    expect(pareceMusica({ track: "X" })).toBe(true);
    expect(pareceMusica({ uploader: "Aimer - Topic" })).toBe(true);
  });
  it("no toma un canal de recetas por un artista", () => {
    // «Cómo hacer pan», del canal «Cocina»: no hay artista en el título.
    expect(pareceMusica({ title: "Cómo hacer pan", uploader: "Cocina", duration: 600 })).toBe(false);
    expect(pareceMusica({ title: "Tutorial de Excel", uploader: "Cursos", duration: 1200 })).toBe(false);
  });
  it("acepta un «Artista - Canción» claro", () => {
    expect(pareceMusica({ title: "Aimer - 残響散歌", uploader: "Aimer", duration: 200 })).toBe(true);
  });
  it("no confunde un directo de 3 horas con una canción", () => {
    expect(pareceMusica({ title: "Chill beats to study", uploader: "LoFi Girl", duration: 20000 })).toBe(false);
  });
});

describe("familia y soporte por contenedor", () => {
  it("clasifica las extensiones que de verdad se descargan", () => {
    expect(familiaDe("/x/a.mp3")).toBe("id3");
    expect(familiaDe("C:\\y\\b.M4A")).toBe("mp4");
    expect(familiaDe("c.flac")).toBe("flac");
    expect(familiaDe("d.opus")).toBe("vorbis");
    expect(familiaDe("e.mkv")).toBe("matroska");
    expect(familiaDe("f.wav")).toBe("riff");
    expect(familiaDe("g.aac")).toBe("ninguna");
    expect(admiteEtiquetas("g.aac")).toBe(false);
  });

  it("dice la verdad sobre la carátula según el contenedor", () => {
    expect(soporteCaratula("a.mp3")).toMatchObject({ si: true, modo: "pista" });
    expect(soporteCaratula("a.m4a")).toMatchObject({ si: true, modo: "pista" });
    expect(soporteCaratula("a.flac")).toMatchObject({ si: true, modo: "pista" });
    // Comprobado en vivo: el muxer de Ogg rechaza `attached_pic`.
    expect(soporteCaratula("a.opus")).toMatchObject({ si: false, modo: "no" });
    expect(soporteCaratula("a.opus").motivo).toContain("Opus");
    // MKV: adjunto, NO pista de vídeo (una pista de vídeo de 1 fotograma rompe
    // la reproducción en algunos reproductores).
    expect(soporteCaratula("a.mkv")).toMatchObject({ si: true, modo: "adjunto" });
    expect(soporteCaratula("a.wav").si).toBe(false);
    expect(soporteCaratula("a.aac").si).toBe(false);
  });
});

describe("argsDeEtiquetas", () => {
  const t: Etiquetas = { titulo: "Canción", artista: "Artista", album: "Álbum", artistaAlbum: "Varios", genero: "Pop", fecha: "1987-11-12", pista: "3/12", disco: "1", compositor: "C", comentario: "https://x", letra: "uno\ndos", isrc: "USRC17607839" };

  it("escribe los campos estándar en minúsculas para mp3/m4a/flac", () => {
    const a = argsDeEtiquetas(t, "/x/a.mp3");
    expect(a).toContain("title=Canción");
    expect(a).toContain("album_artist=Varios");
    expect(a).toContain("ISRC=USRC17607839");
    // Cada valor va precedido de su -metadata
    expect(a.filter((x) => x === "-metadata").length).toBe(12);
  });

  it("en MKV usa MAYÚSCULAS y DATE_RELEASED (con `date` el muxer la tira)", () => {
    const a = argsDeEtiquetas(t, "/x/a.mkv").join(" ");
    expect(a).toContain("TITLE=Canción");
    expect(a).toContain("ARTIST=Artista");
    expect(a).toContain("DATE_RELEASED=1987-11-12");
    expect(a).not.toContain("date=");
  });

  it("en WAV sólo escribe lo que el chunk INFO admite", () => {
    const campos = camposAplicables("/x/a.wav");
    expect(campos).toContain("titulo");
    expect(campos).not.toContain("pista");
    expect(campos).not.toContain("artistaAlbum");
  });

  it("no escribe nada para un contenedor sin metadatos", () => {
    expect(argsDeEtiquetas(t, "/x/a.aac")).toEqual([]);
    expect(camposAplicables("/x/a.aac")).toEqual([]);
  });

  it("omite los campos vacíos en vez de escribir «title=»", () => {
    const a = argsDeEtiquetas({ titulo: "Solo" }, "/x/a.mp3");
    expect(a).toEqual(["-metadata", "title=Solo"]);
  });

  it("normaliza los saltos de línea de la letra (un `\\r\\n` en un argumento es un lío)", () => {
    const a = argsDeEtiquetas({ letra: "uno\r\ndos\r\ntres" }, "/x/a.mp3");
    expect(a[1]).toBe("lyrics=uno\ndos\ntres");
  });
});

describe("fusionar / hayEtiquetas", () => {
  it("lo de encima gana sólo donde trae algo", () => {
    const base: Etiquetas = { titulo: "T", artista: "A", album: "De la lista", genero: "Rock" };
    const r = fusionar(base, { titulo: "T2", album: "", genero: "  " });
    expect(r).toMatchObject({ titulo: "T2", artista: "A", album: "De la lista", genero: "Rock" });
  });
  it("hayEtiquetas distingue vacío de lleno", () => {
    expect(hayEtiquetas({})).toBe(false);
    expect(hayEtiquetas({ titulo: "  " })).toBe(false);
    expect(hayEtiquetas({ titulo: "x" })).toBe(true);
  });
});
