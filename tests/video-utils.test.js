const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildAssContent,
  buildSrtContent,
  buildSubtitleChunks,
  buildSubtitleTimeline,
  estimateDurationSeconds,
  formatSrtTimestamp,
  pickFirstImage,
  splitLongWordStrict,
  stripHtmlToText,
  wrapChunkToLines,
} = require("../video-utils");

test("stripHtmlToText limpia etiquetas y entidades", () => {
  const dirty = "<p>Hola&nbsp;<strong>mundo</strong> &amp; equipo<br>desde CdelU</p>";
  const clean = stripHtmlToText(dirty);
  assert.equal(clean, "Hola mundo & equipo desde CdelU");
});

test("buildSubtitleChunks segmenta en bloques cortos mobile-first", () => {
  const chunks = buildSubtitleChunks(
    "",
    "Primera frase corta, segunda frase mucho mas larga para que se divida en bloques de subtitulo.",
    {
      includeTitle: false,
      maxWordsPerChunk: 4,
      minWordsPerChunk: 3,
      maxWordLength: 18,
    },
  );
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.split(" ").length <= 4));
  assert.ok(chunks.every((chunk) => chunk.trim().length > 0));
});

test("splitLongWordStrict corta palabras muy largas", () => {
  const parts = splitLongWordStrict("superhipermegaultralargapalabra", 18);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((part) => part.length <= 18));
});

test("timeline usa duracion completa y ordenada", () => {
  const chunks = ["Uno", "Dos tres", "Cuatro cinco seis"];
  const duration = estimateDurationSeconds(chunks, {
    minDuration: 10,
    maxDuration: 20,
    wordsPerSecond: 2.5,
  });
  const timeline = buildSubtitleTimeline(chunks, duration);
  assert.equal(timeline.length, chunks.length);
  assert.equal(timeline[0].start, 0);
  assert.ok(timeline[2].end <= duration + 0.001);
  assert.ok(timeline[1].start < timeline[1].end);
});

test("buildSrtContent genera formato srt valido", () => {
  const timeline = [
    { index: 1, start: 0, end: 1.5, text: "Linea 1" },
    { index: 2, start: 1.5, end: 3.2, text: "Linea 2" },
  ];
  const srt = buildSrtContent(timeline);
  assert.match(srt, /00:00:00,000 --> 00:00:01,500/);
  assert.match(srt, /Linea 2/);
  assert.equal(formatSrtTimestamp(3723.45), "01:02:03,450");
});

test("buildAssContent genera estilo con safe-zone y fade", () => {
  const timeline = [{ index: 1, start: 0, end: 2.1, text: "texto de prueba mobile" }];
  const ass = buildAssContent(timeline, {
    playResX: 1080,
    playResY: 1920,
    subtitleMaxTextWidthRatio: 0.8,
    subtitleYRatio: 0.7,
    subtitleFontName: "Montserrat ExtraBold",
    subtitleFontSize: 60,
  });
  assert.match(ass, /Style: Mobile,Montserrat ExtraBold,60/);
  assert.match(ass, /\\fad\(120,120\)/);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:02.10,Mobile/);
});

test("wrapChunkToLines respeta ancho maximo", () => {
  const lines = wrapChunkToLines("este texto necesita saltos de linea controlados", {
    maxCharsPerLine: 20,
    maxLines: 2,
  });
  assert.ok(lines.length <= 2);
  assert.ok(lines.every((line) => line.length > 0));
});

test("fixture local: detecta imagen principal esperada", async () => {
  const fixturePath = path.resolve(__dirname, "../fixtures/post-sample.json");
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  assert.equal(
    pickFirstImage(fixture),
    "https://cdn.example.com/media/portada.jpg",
  );
});
