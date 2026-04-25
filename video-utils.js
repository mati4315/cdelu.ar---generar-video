const path = require("path");

const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  bull: "-",
};

function decodeHtmlEntities(input) {
  if (!input) return "";
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const mapped = ENTITY_MAP[entity.toLowerCase()];
    return mapped !== undefined ? mapped : match;
  });
}

function stripHtmlToText(input) {
  if (typeof input !== "string") return "";
  const withoutScript = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutScript.replace(/<\/?(p|div|br|li|h[1-6])[^>]*>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(noTags));
}

function normalizeWhitespace(input) {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim();
}

function countWords(input) {
  if (!input) return 0;
  return normalizeWhitespace(input).split(" ").filter(Boolean).length;
}

function splitIntoSentences(input) {
  const text = normalizeWhitespace(input);
  if (!text) return [];
  const matches = text.match(/[^.!?]+[.!?]?/g);
  return (matches || [])
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean);
}

function splitIntoClauses(input) {
  const text = normalizeWhitespace(input);
  if (!text) return [];
  const matches = text.match(/[^,.;:!?]+[,.!?;:]*/g);
  return (matches || [])
    .map((clause) => normalizeWhitespace(clause))
    .filter(Boolean);
}

function splitLongWordStrict(word, maxWordLength = 18) {
  if (!word) return [];
  const clean = normalizeWhitespace(word);
  if (!clean) return [];
  if (clean.length <= maxWordLength) return [clean];

  const parts = [];
  const chunkLength = Math.max(6, maxWordLength - 1);
  for (let index = 0; index < clean.length; index += chunkLength) {
    const piece = clean.slice(index, index + chunkLength);
    if (index + chunkLength < clean.length) {
      parts.push(`${piece}-`);
    } else {
      parts.push(piece);
    }
  }
  return parts;
}

function mergeTinyChunks(chunks, minWordsPerChunk, maxWordsPerChunk) {
  const output = [];
  for (const chunk of chunks) {
    const words = normalizeWhitespace(chunk).split(" ").filter(Boolean);
    if (output.length && words.length < minWordsPerChunk) {
      const previousWords = output[output.length - 1].split(" ").filter(Boolean);
      if (previousWords.length + words.length <= maxWordsPerChunk) {
        output[output.length - 1] = `${output[output.length - 1]} ${chunk}`;
        continue;
      }
    }
    output.push(chunk);
  }
  return output;
}

function buildSubtitleChunks(title, content, options = {}) {
  const {
    includeTitle = false,
    maxWordsPerChunk = 4,
    minWordsPerChunk = 3,
    maxWordLength = 18,
    maxChunks = 60,
  } = options;

  const chunks = [];
  const cleanTitle = normalizeWhitespace(stripHtmlToText(title));
  if (includeTitle && cleanTitle) {
    chunks.push(cleanTitle);
  }

  const cleanContent = normalizeWhitespace(stripHtmlToText(content));
  const clauses = splitIntoClauses(cleanContent);

  for (const clause of clauses) {
    const clauseWordsRaw = normalizeWhitespace(clause).split(" ").filter(Boolean);
    const clauseWords = clauseWordsRaw.flatMap((word) => splitLongWordStrict(word, maxWordLength));

    let buffer = [];
    for (const word of clauseWords) {
      buffer.push(word);
      if (buffer.length >= maxWordsPerChunk) {
        chunks.push(buffer.join(" "));
        buffer = [];
        if (chunks.length >= maxChunks) return chunks;
      }
    }

    if (buffer.length) {
      chunks.push(buffer.join(" "));
      if (chunks.length >= maxChunks) return chunks;
    }
  }

  return mergeTinyChunks(chunks, minWordsPerChunk, maxWordsPerChunk).slice(0, maxChunks);
}

function wrapChunkToLines(input, options = {}) {
  const {
    maxCharsPerLine = 20,
    maxLines = 2,
  } = options;

  const words = normalizeWhitespace(input).split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let current = "";

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }
  }

  if (current) lines.push(current);
  
  // Limitar drásticamente la pérdida de texto, pero si se exige no pasar maxLines, al menos intentar
  // que las primeras lineas se mantengan sin quebrar toda la pantalla a lo ancho.
  return lines;
}

function estimateDurationSeconds(chunks, options = {}) {
  const {
    wordsPerSecond = 2.8,
    minDuration = 12,
    maxDuration = 90,
    introPaddingSeconds = 2,
  } = options;
  const totalWords = chunks.reduce((sum, chunk) => sum + countWords(chunk), 0);
  const estimated = (totalWords / wordsPerSecond) + introPaddingSeconds;
  return clamp(Number.isFinite(estimated) ? estimated : minDuration, minDuration, maxDuration);
}

function buildSubtitleTimeline(chunks, totalDuration, options = {}) {
  const {
    minChunkDuration = 0.9,
  } = options;

  if (!chunks.length) return [];

  const weights = chunks.map((chunk) => Math.max(countWords(chunk), 2));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  // We strictly bound the subtitles to the totalDuration to remain synced with the audio / video bounds.
  // minChunkDuration is only a loose request.
  const durations = weights.map((weight) => {
    return (weight / totalWeight) * totalDuration;
  });

  const currentTotal = durations.reduce((sum, value) => sum + value, 0);
  const ratio = totalDuration / currentTotal;
  const scaled = durations.map((value) => value * ratio);

  const timeline = [];
  let cursor = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const start = cursor;
    const end = i === chunks.length - 1 ? totalDuration : cursor + scaled[i];
    timeline.push({
      index: i + 1,
      text: chunks[i],
      start,
      end: Math.max(end, start + 0.18),
    });
    cursor = end;
  }

  return timeline;
}

function formatSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;

  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    secs.toString().padStart(2, "0"),
  ].join(":") + `,${millis.toString().padStart(3, "0")}`;
}

function formatAssTimestamp(seconds) {
  const totalCentis = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentis / 360000);
  const minutes = Math.floor((totalCentis % 360000) / 6000);
  const secs = Math.floor((totalCentis % 6000) / 100);
  const centis = totalCentis % 100;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${centis.toString().padStart(2, "0")}`;
}

function buildSrtContent(timeline) {
  return timeline
    .map((item) => {
      const start = formatSrtTimestamp(item.start);
      const end = formatSrtTimestamp(item.end);
      return `${item.index}\n${start} --> ${end}\n${item.text}\n`;
    })
    .join("\n");
}

function escapeAssLine(line) {
  return String(line || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, " ");
}

function buildAssContent(timeline, options = {}) {
  const {
    playResX = 1080,
    playResY = 1920,
    subtitleFontName = "Montserrat ExtraBold",
    subtitleFontSize = 60,
    subtitleMaxTextWidthRatio = 0.8,
    subtitleYRatio = 0.80,
    subtitleMaxCharsPerLine = 20,
    subtitleMaxLines = 2,
    subtitlePrimaryColour = "&H0015CCFA",
    subtitleOutlineColour = "&H00000000",
    subtitleOutline = 6,
    subtitleShadow = 3,
    fadeInMs = 120,
    fadeOutMs = 120,
  } = options;

  const marginHorizontal = Math.round((playResX * (1 - subtitleMaxTextWidthRatio)) / 2);
  const marginVertical = Math.round(playResY * (1 - subtitleYRatio));

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
      + "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
      + "Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Mobile,${subtitleFontName},${subtitleFontSize},${subtitlePrimaryColour},${subtitlePrimaryColour},`
      + `${subtitleOutlineColour},&H00000000,-1,0,0,0,100,100,0,0,1,${subtitleOutline},${subtitleShadow},`
      + `2,${marginHorizontal},${marginHorizontal},${marginVertical},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const dialogues = timeline.map((item) => {
    const lines = wrapChunkToLines(item.text, {
      maxCharsPerLine: subtitleMaxCharsPerLine,
      maxLines: subtitleMaxLines,
    });
    const renderedText = lines.map(escapeAssLine).join("\\N");
    return `Dialogue: 0,${formatAssTimestamp(item.start)},${formatAssTimestamp(item.end)},Mobile,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})}${renderedText}`;
  });

  return [...header, ...dialogues, ""].join("\n");
}

function sanitizeFilename(input) {
  const clean = normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return clean || "video";
}

function escapePathForFfmpegFilter(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return normalized
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}

function pickFirstImage(post) {
  if (!post || typeof post !== "object") return null;
  if (Array.isArray(post.images)) {
    const found = post.images.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    if (found) return found;
  }
  if (typeof post.image === "string" && /^https?:\/\//i.test(post.image)) return post.image;
  if (typeof post.image_url === "string" && /^https?:\/\//i.test(post.image_url)) return post.image_url;
  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  buildAssContent,
  buildSrtContent,
  buildSubtitleChunks,
  buildSubtitleTimeline,
  clamp,
  countWords,
  decodeHtmlEntities,
  escapePathForFfmpegFilter,
  estimateDurationSeconds,
  formatAssTimestamp,
  formatSrtTimestamp,
  normalizeWhitespace,
  pickFirstImage,
  sanitizeFilename,
  splitIntoClauses,
  splitIntoSentences,
  splitLongWordStrict,
  stripHtmlToText,
  wrapChunkToLines,
};
