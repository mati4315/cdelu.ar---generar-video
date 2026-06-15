#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const axios = require("axios");
const ffmpegPath = require("ffmpeg-static");
require("dotenv").config();

const {
  buildAssContent,
  buildSubtitleChunks,
  buildSubtitleTimeline,
  escapePathForFfmpegFilter,
  estimateDurationSeconds,
  normalizeWhitespace,
  pickFirstImage,
  sanitizeFilename,
  splitLongWordStrict,
  stripHtmlToText,
} = require("./video-utils");

class BotError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "BotError";
    this.code = code;
    this.details = details;
  }
}

const cwd = process.cwd();
const nowIsoSafe = new Date().toISOString().replace(/[:.]/g, "-");
const args = parseArgs(process.argv.slice(2));
const RESOLUTION_PRESETS = Object.freeze({
  360: { width: 360, height: 640, label: "360x640" },
  480: { width: 480, height: 854, label: "480x854" },
  720: { width: 720, height: 1280, label: "720x1280" },
  1080: { width: 1080, height: 1920, label: "1080x1920" },
});
const requestedResolution = resolveRequestedResolution({
  cliResolution: args.resolution,
  envWidth: parseInteger(process.env.VIDEO_WIDTH, 1080),
  envHeight: parseInteger(process.env.VIDEO_HEIGHT, 1920),
});

const config = {
  wpBaseUrl: normalizeUrl(process.env.WP_BASE_URL || "https://cdelu.io"),
  timeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 20000),
  retryCount: parseInteger(process.env.REQUEST_RETRIES, 3),
  tmpAssetsDir: path.resolve(cwd, process.env.TMP_ASSETS_DIR || "tmp-assets"),
  outputDir: path.resolve(cwd, process.env.OUTPUT_DIR || "videos-generados"),
  musicDir: path.resolve(cwd, process.env.MUSIC_DIR || "musica-stock"),
  fontsDir: path.resolve(cwd, process.env.FONTS_DIR || "fonts"),
  fps: parseInteger(process.env.VIDEO_FPS, 30),
  width: requestedResolution.width,
  height: requestedResolution.height,
  resolutionLabel: requestedResolution.label,
  audioVolume: parseFloatSafe(process.env.AUDIO_VOLUME, 0.24),
  wordsPerSecond: parseFloatSafe(process.env.WORDS_PER_SECOND, 2.2),
  minDurationSec: parseFloatSafe(process.env.MIN_DURATION_SEC, 12),
  maxDurationSec: parseFloatSafe(process.env.MAX_DURATION_SEC, 90),
  subtitleMaxWordsPerChunk: parseInteger(process.env.SUBTITLE_MAX_WORDS_PER_CHUNK, 20),
  subtitleMinWordsPerChunk: parseInteger(process.env.SUBTITLE_MIN_WORDS_PER_CHUNK, 14),
  subtitleMaxWordLength: parseInteger(process.env.SUBTITLE_MAX_WORD_LENGTH, 18),
  subtitleMaxCharsPerLine: parseInteger(process.env.SUBTITLE_MAX_CHARS_PER_LINE, 68),
  subtitleMaxLines: parseInteger(process.env.SUBTITLE_MAX_LINES, 3),
  subtitleWidthRatio: parseFloatSafe(process.env.SUBTITLE_WIDTH_RATIO, 0.8),
  subtitleYRatio: parseFloatSafe(process.env.SUBTITLE_Y_RATIO, 0.68),
  subtitleFontName: process.env.SUBTITLE_FONT_NAME || "Montserrat ExtraBold",
  subtitleFontSize: parseInteger(process.env.SUBTITLE_FONT_SIZE, 60),
  subtitleColor: process.env.SUBTITLE_COLOR || "#FACC15",
  subtitleOutline: parseInteger(process.env.SUBTITLE_OUTLINE, 6),
  subtitleShadow: parseInteger(process.env.SUBTITLE_SHADOW, 3),
  subtitleFadeInMs: parseInteger(process.env.SUBTITLE_FADE_IN_MS, 120),
  subtitleFadeOutMs: parseInteger(process.env.SUBTITLE_FADE_OUT_MS, 120),
  showTitle: parseBoolean(process.env.SHOW_TITLE, true),
  titleYRatio: parseFloatSafe(process.env.TITLE_Y_RATIO, 0.13),

  // Tamaño de la fuente del titulo 
  titleFontSize: parseInteger(process.env.TITLE_FONT_SIZE, 52),
  titleMinFontSize: parseInteger(process.env.TITLE_MIN_FONT_SIZE, 30),
  titleForceFontSize: parseInteger(process.env.TITLE_FORCE_FONT_SIZE, 0),
  titleFitWidth: parseBoolean(process.env.TITLE_FIT_WIDTH, true),


  titleWidthRatio: parseFloatSafe(process.env.TITLE_WIDTH_RATIO, 1),
  titleLineSpacing: parseInteger(process.env.TITLE_LINE_SPACING, 8),
  titleMaxCharsPerLine: parseInteger(process.env.TITLE_MAX_CHARS_PER_LINE, 28),
  titleMaxLines: parseInteger(process.env.TITLE_MAX_LINES, 5),
  titleMaxWordLength: parseInteger(process.env.TITLE_MAX_WORD_LENGTH, 22),
  titleFontFile: process.env.TITLE_FONT_FILE || "",
  postsEndpoint: process.env.POSTS_ENDPOINT,
  markEndpointTemplate: process.env.MARK_ENDPOINT_TEMPLATE,
  wpToken: process.env.WP_VIDEO_BOT_TOKEN || "",
  ttsMaxSpeed: parseFloatSafe(process.env.TTS_MAX_SPEED, 1.4),
  enableIntroLogo: process.env.ENABLE_INTRO_LOGO === "true",
};

config.postsEndpoint = config.postsEndpoint || `${config.wpBaseUrl}/wp-json/cdelu-video/v1/posts`;
config.markEndpointTemplate = config.markEndpointTemplate
  || `${config.wpBaseUrl}/wp-json/cdelu-video/v1/posts/{id}/mark-processed`;

const executionSummary = {
  status: "pending",
  dryRun: args.dryRun,
  resolution: `${config.width}x${config.height}`,
  postId: args.postId || null,
  outputPath: null,
  durationSec: null,
  audioTrack: null,
  audioStartSec: 0,
  audioStartPercent: 0,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  elapsedMs: null,
  markedProcessed: false,
  ffmpegPath,
};

const renderTuning = getRenderTuning(config);

async function main() {
  const startedAt = Date.now();
  try {
    ensureFfmpegAvailable();
    await ensureDirectories();

    const selectedPost = await pickPostToProcess(args.postId);
    executionSummary.postId = selectedPost.id;

    const result = await processPost(selectedPost, {
      dryRun: args.dryRun,
      skipTts: args.skipTts,
      testTts: args.testTts,
      musicVolume: args.musicVolume,
      ttsVolume: args.ttsVolume,
    });

    executionSummary.status = "ok";
    executionSummary.outputPath = result.outputPath;
    executionSummary.durationSec = result.durationSec;
    executionSummary.markedProcessed = result.markedProcessed;
    executionSummary.audioTrack = result.audioTrack || null;
    executionSummary.audioStartSec = Number.isFinite(result.audioStartSec) ? result.audioStartSec : 0;
    executionSummary.audioStartPercent = Number.isFinite(result.audioStartPercent)
      ? result.audioStartPercent
      : 0;
    console.log(`[ok] Video generado: ${result.outputPath}`);
  } catch (error) {
    executionSummary.status = "error";
    const printable = toPrintableError(error);
    console.error(`[error] ${printable.message}`);
    if (printable.code) console.error(`[error-code] ${printable.code}`);
    if (printable.details) console.error(`[error-details] ${JSON.stringify(printable.details)}`);
    process.exitCode = 1;
  } finally {
    executionSummary.finishedAt = new Date().toISOString();
    executionSummary.elapsedMs = Date.now() - startedAt;
    console.log(`[summary] ${JSON.stringify(executionSummary, null, 2)}`);
  }
}

async function pickPostToProcess(targetPostId) {
  const pendingPosts = await fetchPendingPosts();
  if (!Array.isArray(pendingPosts)) {
    throw new BotError("INVALID_API_RESPONSE", "El endpoint de posts no devolvio un array.");
  }

  if (targetPostId) {
    const found = pendingPosts.find((post) => Number(post.id) === Number(targetPostId));
    if (found) return normalizePost(found);
    return fetchPostById(targetPostId);
  }

  if (pendingPosts.length === 0) {
    throw new BotError("API_EMPTY", "No hay posts pendientes para procesar.");
  }
  // Pick the oldest pending post to maintain chronological timelines when posting
  return normalizePost(pendingPosts[pendingPosts.length - 1]);
}

const TTS_PYTHON_EXEC = "D:\\generador de video noticia\\generador del audio\\.venv311\\Scripts\\python.exe";
const TTS_SCRIPT = path.resolve(cwd, "tts_engine", "generate_tts.py");
const TTS_CONFIG = path.resolve(cwd, "tts-config.json");

async function generateTTS(textPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`[tts] Generando audio TTS (leyendo de archivo)...`);
    const child = spawn(TTS_PYTHON_EXEC, [
      TTS_SCRIPT,
      "--config",
      TTS_CONFIG,
      "--input-file",
      textPath,
      "--output",
      outputPath,
    ], { windowsHide: true });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const msg = data.toString();
      stdout += msg;
      process.stdout.write(`[tts-stdout] ${msg}`);
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString();
      stderr += msg;
      process.stderr.write(`[tts-stderr] ${msg}`);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[tts-error] El proceso de TTS finalizo con codigo ${code}`);
        return reject(new BotError("TTS_FAILED", "No se pudo generar el audio TTS."));
      }
      resolve();
    });

    child.on("error", (err) => {
      console.error(`[tts-spawn-error] ${err.message}`);
      reject(new BotError("TTS_SPAWN_ERROR", "No se pudo lanzar el motor de TTS."));
    });
  });
}

async function processPost(post, options) {
  const temporaryPaths = [];
  try {
    const rawTitle = normalizeWhitespace(stripHtmlToText(post.titulo || ""));
    const cleanedTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase(); // Sentence Case basico o Title Case
    const cleanedBody = normalizeWhitespace(stripHtmlToText(post.descripcion || ""));

    if (!cleanedTitle) {
      throw new BotError("EMPTY_TITLE", `El post ${post.id} no tiene titulo utilizable.`);
    }
    if (!cleanedBody) {
      throw new BotError("EMPTY_CONTENT", `El post ${post.id} no tiene contenido utilizable.`);
    }

    const imageUrl = pickFirstImage(post);
    if (!imageUrl) {
      throw new BotError("INVALID_IMAGE_URL", `El post ${post.id} no tiene imagen destacada valida.`);
    }

    let subtitleChunks = buildSubtitleChunks("", cleanedBody, {
      includeTitle: false,
      maxWordsPerChunk: renderTuning.subtitleMaxWordsPerChunk,
      minWordsPerChunk: renderTuning.subtitleMinWordsPerChunk,
      maxWordLength: config.subtitleMaxWordLength,
      maxChunks: 500,
    });

    if (subtitleChunks.length === 0) {
      subtitleChunks = buildSubtitleChunks(cleanedTitle, cleanedTitle, {
        includeTitle: false,
        maxWordsPerChunk: renderTuning.subtitleMaxWordsPerChunk,
        minWordsPerChunk: renderTuning.subtitleMinWordsPerChunk,
        maxWordLength: config.subtitleMaxWordLength,
        maxChunks: 15,
      });
    }
    if (subtitleChunks.length === 0) {
      throw new BotError("EMPTY_SUBTITLES", `No se pudieron generar subtitulos para el post ${post.id}.`);
    }

    let ttsAudioPath = "";
    let videoDurationSec = 0;
    
    let ttsSpeedFactor = 1.0;

    if (!options.skipTts) {
      ttsAudioPath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}-tts.wav`);
      const ttsTextPath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}-tts-input.txt`);
      temporaryPaths.push(ttsAudioPath, ttsTextPath);
      
      await fsp.writeFile(ttsTextPath, cleanedBody, "utf8");
      await generateTTS(ttsTextPath, ttsAudioPath);
      
      const rawTtsDuration = await getMediaDurationSeconds(ttsAudioPath);
      if (!rawTtsDuration || rawTtsDuration < 1) {
        throw new BotError("TTS_INVALID_DURATION", `No se pudo obtener la duracion del audio TTS de ${post.id}.`);
      }

      videoDurationSec = rawTtsDuration;
      
      // Sincronizacion activa: si el audio se pasa del limite, lo aceleramos (hasta un tope)
      if (videoDurationSec > config.maxDurationSec) {
        const requestedSpeed = rawTtsDuration / config.maxDurationSec;
        ttsSpeedFactor = Math.min(requestedSpeed, config.ttsMaxSpeed);
        
        videoDurationSec = rawTtsDuration / ttsSpeedFactor;
        
        console.log(`[tts] Sincronizando audio factor=${ttsSpeedFactor.toFixed(2)} (orig=${rawTtsDuration.toFixed(2)}s, final=${videoDurationSec.toFixed(2)}s)`);
      }
    } else if (options.testTts) {
      console.log("[tts] Modo Test-TTS activo: Buscando ultimo audio generado en D:\\generador de video noticia\\generador del audio\\salidas...");
      const ttsExternalDir = "D:\\generador de video noticia\\generador del audio\\salidas";
      try {
        const files = await fsp.readdir(ttsExternalDir);
        const ttsFiles = files.filter(f => f.endsWith(".wav"));
        if (ttsFiles.length > 0) {
          // Ordenar por fecha de modificación (el ultimo primero)
          ttsFiles.sort((a, b) => {
            return fs.statSync(path.join(ttsExternalDir, b)).mtimeMs - fs.statSync(path.join(ttsExternalDir, a)).mtimeMs;
          });
          ttsAudioPath = path.join(ttsExternalDir, ttsFiles[0]);
          console.log(`[tts] Reutilizando ultimo audio externo: ${ttsFiles[0]}`);

          const rawTtsDuration = await getMediaDurationSeconds(ttsAudioPath);
          if (rawTtsDuration && rawTtsDuration >= 1) {
            videoDurationSec = rawTtsDuration;
            if (videoDurationSec > config.maxDurationSec) {
              const requestedSpeed = rawTtsDuration / config.maxDurationSec;
              ttsSpeedFactor = Math.min(requestedSpeed, config.ttsMaxSpeed);
              videoDurationSec = rawTtsDuration / ttsSpeedFactor;
              console.log(`[tts] Sincronizando audio factor=${ttsSpeedFactor.toFixed(2)}`);
            }
          } else {
            const wordCount = cleanedBody.split(/\s+/).length || 1;
            videoDurationSec = wordCount / config.wordsPerSecond;
          }
        } else {
          console.log("[tts] No se encontro audio en D:\\generador de video noticia\\generador del audio\\salidas. Omitiendo.");
          const wordCount = cleanedBody.split(/\s+/).length || 1;
          videoDurationSec = wordCount / config.wordsPerSecond;
        }
      } catch (err) {
        console.log(`[tts] Error accediendo a D:\\generador de video noticia\\generador del audio\\salidas: ${err.message}`);
        const wordCount = cleanedBody.split(/\s+/).length || 1;
        videoDurationSec = wordCount / config.wordsPerSecond;
      }
    } else {
      console.log(`[tts] Omitiendo generacion narrativa por bandera --skip-tts.`);
      const wordCount = cleanedBody.split(/\s+/).length || 1;
      videoDurationSec = wordCount / config.wordsPerSecond;
    }

    // Aplicar limites globales post-calculo
    if (videoDurationSec < config.minDurationSec) videoDurationSec = config.minDurationSec;
    if (videoDurationSec > config.maxDurationSec) videoDurationSec = config.maxDurationSec;

    videoDurationSec += 1.0; // Espacio extra de lingering para que no termine bruscamente.

    let introOffset = 0;
    const logoPath = path.join(__dirname, "logo", "logo.png"); // o jpg
    if (config.enableIntroLogo && fs.existsSync(logoPath)) {
      introOffset = 1.0; // 1.0 seg visibilidad pura (0.5 extra de fade consumen t del main video)
      console.log(`[intro] Intro activado, desplazando subtitulos y audio por ${introOffset}s`);
    }

    // Sumar el offset a la duracion final del video
    videoDurationSec += introOffset;
    
    // Primero construimos la timeline de subtitulos basada unicamente en el tiempo disponible de relato
    let subtitleTimeline = buildSubtitleTimeline(subtitleChunks, videoDurationSec - introOffset, {
      minChunkDuration: 1.4,
    });

    // Luego desplazamos los tiempos temporalmente hacia adelante para saltar la intro
    if (introOffset > 0) {
      subtitleTimeline = subtitleTimeline.map(item => ({
        ...item,
        start: item.start + introOffset,
        end: item.end + introOffset
      }));
    }

    const imageExt = extensionFromUrl(imageUrl) || ".jpg";
    const imagePath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}${imageExt}`);
    const subtitlesPath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}.ass`);
    const titleTextPath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}-title.txt`);
    temporaryPaths.push(imagePath, subtitlesPath, titleTextPath);

    const outputSlug = sanitizeFilename(cleanedTitle);
    const outputFile = `${post.id}-${nowIsoSafe}-${outputSlug}.mp4`;
    const outputPath = path.join(config.outputDir, outputFile);

    await downloadFileWithRetries(imageUrl, imagePath, config.retryCount);
    await fsp.writeFile(subtitlesPath, buildAssContent(subtitleTimeline, {
      playResX: config.width,
      playResY: config.height,
      subtitleFontName: config.subtitleFontName,
      subtitleFontSize: renderTuning.subtitleFontSize,
      subtitleMaxTextWidthRatio: config.subtitleWidthRatio,
      subtitleYRatio: config.subtitleYRatio,
      subtitleMaxCharsPerLine: renderTuning.subtitleMaxCharsPerLine,
      subtitleMaxLines: config.subtitleMaxLines,
      subtitlePrimaryColour: hexToAssColor(config.subtitleColor),
      subtitleOutline: renderTuning.subtitleOutline,
      subtitleShadow: renderTuning.subtitleShadow,
      fadeInMs: config.subtitleFadeInMs,
      fadeOutMs: config.subtitleFadeOutMs,
    }), "utf8");

    const titleLayout = buildTitleLayout(cleanedTitle, renderTuning);
    console.log(
      `[title] font=${titleLayout.fontSize}px (force=${config.titleForceFontSize || 0}, max=${renderTuning.titleFontSize}, min=${renderTuning.titleMinFontSize})`,
    );
    await fsp.writeFile(titleTextPath, titleLayout.text, "utf8");

    const availableMusic = await listAudioFiles(config.musicDir);
    let audioPath;
    let audioTrack = null;
    let audioStartSec = 0;
    let audioStartPercent = 0;
    if (availableMusic.length > 0) {
      audioPath = chooseRandom(availableMusic);
      audioTrack = path.basename(audioPath);
      console.log(`[audio] Pista aleatoria seleccionada: ${audioTrack}`);

      const audioDurationSec = await getMediaDurationSeconds(audioPath);
      if (Number.isFinite(audioDurationSec) && audioDurationSec > 2) {
        const startMin = audioDurationSec * 0.1;
        const startMax = audioDurationSec * 0.7;
        audioStartSec = randomBetween(startMin, startMax);
        audioStartPercent = audioStartSec / audioDurationSec;
        console.log(
          `[audio] Inicio aleatorio: ${audioStartSec.toFixed(2)}s (${(audioStartPercent * 100).toFixed(1)}% del track)`,
        );
      } else {
        console.warn("[audio] No se pudo calcular duraciÃ³n del track; inicio en 0s.");
      }
    } else {
      audioPath = path.join(config.tmpAssetsDir, `${post.id}-${nowIsoSafe}-tone.mp3`);
      temporaryPaths.push(audioPath);
      console.log("[audio] No hay MP3 en musica-stock. Generando tono base.");
      await generateToneAudio(audioPath, videoDurationSec);
      audioTrack = path.basename(audioPath);
    }

    await renderVideo({
      imagePath,
      subtitlesPath,
      titleTextPath,
      audioPath,          // Música base
      audioTtsPath: ttsAudioPath, // Audio generado de voz
      ttsSpeedFactor,            // Factor de velocidad para atempo
      introOffset,
      outputPath,
      durationSec: videoDurationSec,
      titleLayout,
      audioStartSec,
      musicVolume: options.musicVolume,
      ttsVolume: options.ttsVolume,
    });

    await validateRenderedVideo(outputPath);

    let markedProcessed = false;
    if (options.dryRun) {
      console.log("[dry-run] Se omite mark-processed por bandera --dry-run.");
    } else {
      await markPostAsProcessed(post.id);
      markedProcessed = true;
    }

    return {
      outputPath,
      durationSec: videoDurationSec,
      markedProcessed,
      audioTrack,
      audioStartSec,
      audioStartPercent,
    };
  } finally {
    await cleanupTempFiles(temporaryPaths);
  }
}

async function fetchPendingPosts() {
  const headers = {};
  if (config.wpToken) headers.Authorization = `Bearer ${config.wpToken}`;
  try {
    const urlObj = new URL(config.postsEndpoint);
    urlObj.searchParams.set("_t", Date.now());

    const response = await requestWithRetry(() => axios.get(urlObj.toString(), {
      headers,
      proxy: false,
      timeout: config.timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
    }), config.retryCount);
    return response.data;
  } catch (error) {
    throw new BotError("POSTS_FETCH_FAILED", "No se pudieron obtener los posts pendientes.", {
      endpoint: config.postsEndpoint,
      reason: toPrintableError(error).message,
    });
  }
}

async function fetchPostById(postId) {
  const endpoint = `${config.wpBaseUrl}/wp-json/wp/v2/cdelu-ar/${postId}?_embed`;
  try {
    const response = await requestWithRetry(() => axios.get(endpoint, {
      proxy: false,
      timeout: config.timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
    }), config.retryCount);

    const body = response.data || {};
    const title = body.title?.rendered || "";
    const description = body.content?.rendered || "";
    const featured = body._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "";

    return normalizePost({
      id: body.id,
      titulo: title,
      descripcion: description,
      images: featured ? [featured] : [],
    });
  } catch (error) {
    throw new BotError(
      "POST_ID_NOT_FOUND",
      `No se encontro el post ${postId} ni en pendientes ni en wp/v2.`,
      { endpoint, reason: toPrintableError(error).message },
    );
  }
}

function normalizePost(rawPost) {
  if (!rawPost || typeof rawPost !== "object") {
    throw new BotError("INVALID_POST", "Post invalido recibido desde API.");
  }
  const id = Number(rawPost.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BotError("INVALID_POST_ID", "Post sin id numerico valido.");
  }
  return {
    ...rawPost,
    id,
    titulo: rawPost.titulo || rawPost.title || "",
    descripcion: rawPost.descripcion || rawPost.content || "",
  };
}

async function markPostAsProcessed(postId) {
  const endpoint = config.markEndpointTemplate.replace("{id}", String(postId));
  const headers = {};
  if (config.wpToken) headers.Authorization = `Bearer ${config.wpToken}`;

  try {
    const response = await requestWithRetry(() => axios.post(
      endpoint,
      {},
      {
        headers,
        proxy: false,
        timeout: config.timeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      },
    ), config.retryCount);

    if (!response.data || response.data.success !== true) {
      throw new BotError("MARK_PROCESS_FAILED", "WordPress respondio sin success=true.", {
        endpoint,
        response: response.data,
      });
    }
  } catch (error) {
    if (error instanceof BotError) throw error;
    throw new BotError("MARK_PROCESS_FAILED", `Fallo al marcar el post ${postId} como procesado.`, {
      endpoint,
      reason: toPrintableError(error).message,
    });
  }
}

async function downloadFileWithRetries(url, destinationPath, retries) {
  try {
    await requestWithRetry(async () => {
      const response = await axios.get(url, {
        responseType: "stream",
        proxy: false,
        timeout: config.timeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destinationPath);
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      return true;
    }, retries);
  } catch (error) {
    throw new BotError("IMAGE_DOWNLOAD_FAILED", "No se pudo descargar la imagen destacada.", {
      url,
      reason: toPrintableError(error).message,
    });
  }
}

async function generateToneAudio(destinationPath, durationSec) {
  const argsTone = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:sample_rate=44100:duration=${durationSec.toFixed(3)}`,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "4",
    destinationPath,
  ];
  await runFfmpeg(argsTone, "tone");
}

async function getMediaDurationSeconds(filePath) {
  return new Promise((resolve) => {
    let stderrLog = "";
    let settled = false;

    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-i",
      filePath,
      "-f",
      "null",
      "-",
    ], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const finalize = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    child.stderr.on("data", (chunk) => {
      stderrLog += chunk.toString();
    });

    child.on("error", () => finalize(null));

    child.on("close", () => {
      const match = stderrLog.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
      if (!match) {
        finalize(null);
        return;
      }
      const hours = Number.parseInt(match[1], 10);
      const minutes = Number.parseInt(match[2], 10);
      const seconds = Number.parseFloat(match[3]);
      const total = (hours * 3600) + (minutes * 60) + seconds;
      finalize(Number.isFinite(total) ? total : null);
    });
  });
}

async function renderVideo({
  imagePath,
  subtitlesPath,
  titleTextPath,
  titleLayout,
  audioPath,
  audioTtsPath,
  ttsSpeedFactor = 1.0,
  introOffset = 0.0,
  outputPath,
  durationSec,
  audioStartSec = 0,
  musicVolume,
  ttsVolume,
}) {
  const fadeStart = Math.max(durationSec - 2, 0);
  const escapedSubtitles = escapePathForFfmpegFilter(subtitlesPath);
  const escapedFontsDir = escapePathForFfmpegFilter(config.fontsDir);
  const fgWidth = config.width;
  const fgHeight = Math.round(config.height * renderTuning.fgHeightRatio);
  const totalFrames = Math.max(1, Math.round(durationSec * config.fps));
  const motion = pickRandomImageMotion(totalFrames, renderTuning);
  const titleFontPath = resolveTitleFontPath();
  console.log(`[motion] Efecto visual: ${motion.name}`);

  const layers = [];
  
  const logoPath = path.join(__dirname, "logo", "logo.png");
  const hasLogo = fs.existsSync(logoPath);
  let useIntro = false;
  let useWatermark = hasLogo; // Watermark si hay logo

  let logoInputIndex = -1;
  let watermarkInputIndex = -1;
  
  const audioInputIndex = 1;
  const ttsInputIndex = audioTtsPath ? 2 : -1;
  let nextInputIndex = audioTtsPath ? 3 : 2;
  
  if (config.enableIntroLogo && hasLogo && introOffset > 0) {
    useIntro = true;
    logoInputIndex = nextInputIndex++; 
  }
  
  if (useWatermark) {
    watermarkInputIndex = nextInputIndex++;
  }

  if (renderTuning.customVideoPipeline && renderTuning.customVideoPipeline.trim() !== "") {
    let custom = renderTuning.customVideoPipeline.trim();
    custom = custom.replace(/\r?\n/g, "").trim(); // allow multiline pasting 
    if (!custom.includes("[0:v]") && !custom.includes("[base]")) {
       // if it's a simple filter chain, wrap it automatically
       layers.push(`[0:v]${custom},format=yuv420p[base]`);
    } else {
       // already constructed custom graph
       // Auto-append [base] if they forgot to label the final output
       if (!custom.includes("[base]")) {
           custom += "[base]";
       }
       layers.push(custom);
    }
  } else {
    layers.push(
      `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase,crop=${config.width}:${config.height},boxblur=${renderTuning.bgBlurRadius}:${renderTuning.bgBlurPower},eq=brightness=${renderTuning.bgBrightness.toFixed(2)}:saturation=0.92,fps=${config.fps},format=yuv420p[bg]`,
      `[0:v]scale=${fgWidth}:${fgHeight}:force_original_aspect_ratio=increase,crop=${fgWidth}:${fgHeight},zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=1:s=${fgWidth}x${fgHeight}:fps=${config.fps},unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${renderTuning.fgSharpen.toFixed(2)}:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.0,format=rgba[fg]`,
      "[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[base]"
    );
  }

  // Homologar la resolución base sin importar de dónde venga. Así drawtext y subtitles usarán el tamaño real deseado
  layers.push(`[base]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2:color=black,setpts=PTS-STARTPTS,format=yuv420p[base_scaled]`);

  if (config.showTitle && titleLayout.text && titleLayout.fontSize > 0) {
    const drawTextOptions = [
      `fontfile='${escapePathForFfmpegFilter(titleFontPath)}'`,
      `textfile='${escapePathForFfmpegFilter(titleTextPath)}'`,
      "fontcolor=white",
      `fontsize=${titleLayout.fontSize}`,
      `line_spacing=${renderTuning.titleLineSpacing}`,
      "fix_bounds=1",
      `borderw=${Math.max(1, Math.round(titleLayout.fontSize * 0.11))}`,
      "bordercolor=black@0.95",
      "shadowx=0",
      `shadowy=${Math.max(1, Math.round(titleLayout.fontSize * 0.08))}`,
      "shadowcolor=black@0.85",
      "box=1",
      "boxcolor=black@0.5",
      `boxborderw=${Math.max(4, Math.round(titleLayout.fontSize * 0.45))}`,
      "x=(w-text_w)/2",
      `y=${Math.round(config.height * renderTuning.titleYRatio)}`,
      "text_align=center",
    ];
    const drawText = `drawtext=${drawTextOptions.join(":")}`;
    layers.push(`[base_scaled]${drawText}[titled]`);
  } else {
    layers.push("[base_scaled]null[titled]");
  }

  // Si hay Intro, aplicamos el XFADE justo antes de los subtitulos
  let finalVideoMapForDrawText = "titled";
  
  if (useIntro) {
    const transitions = ["fade", "wipeleft", "wiperight", "slideleft", "slideright", "circlecrop", "rectcrop", "distance", "radial"];
    const randomTrans = transitions[Math.floor(Math.random() * transitions.length)];
    
    // Logo dura 1.5 seg antes de hacer merge, asegurando tambien resolucion exacta y FPS.
    layers.push(`[${logoInputIndex}:v]loop=loop=-1:size=2,scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${config.fps},trim=duration=1.5,setpts=PTS-STARTPTS,format=yuv420p[logo]`);
    
    // Mezcla cruzada
    layers.push(`[logo][${finalVideoMapForDrawText}]xfade=transition=${randomTrans}:duration=0.5:offset=1.0[xfaded]`);
    finalVideoMapForDrawText = "xfaded";
  }

  // Marca de agua en la parte inferior derecha, 60% transparente, aparece tras el introOffset
  if (useWatermark) {
    // Leer config desde process.env (viene desde server.js)
    const wmSizePercent = process.env.WATERMARK_SIZE ? parseInt(process.env.WATERMARK_SIZE) / 100 : 0.15;
    const wmMarginY = process.env.WATERMARK_MARGIN_Y !== undefined ? parseInt(process.env.WATERMARK_MARGIN_Y) : 40;
    const wmMarginX = process.env.WATERMARK_MARGIN_X !== undefined ? parseInt(process.env.WATERMARK_MARGIN_X) : 30;

    // Escalar basado en el porcentaje del ancho de pantalla manteniendo ratio, fijamos opacity al 40% (60% transparente)
    const wmWidth = Math.round(config.width * wmSizePercent);
    layers.push(`[${watermarkInputIndex}:v]scale=${wmWidth}:-1,colorchannelmixer=aa=0.40[wm_scaled]`);
    // Overlay abajo a la derecha, activando cuando empiece el subtitulo
    layers.push(`[${finalVideoMapForDrawText}][wm_scaled]overlay=W-w-${wmMarginX}:H-h-${wmMarginY}:enable='gte(t,${introOffset})'[with_wm]`);
    finalVideoMapForDrawText = "with_wm";
  }

  const subtitleLayer = fs.existsSync(config.fontsDir)
    ? `[${finalVideoMapForDrawText}]subtitles='${escapedSubtitles}':fontsdir='${escapedFontsDir}'[v_sub]`
    : `[${finalVideoMapForDrawText}]subtitles='${escapedSubtitles}'[v_sub]`;
  layers.push(subtitleLayer);

  let finalVideoMap = "v_sub";
  let filterComplex = "";
  const volMusic = Number.isFinite(musicVolume) && musicVolume !== null ? musicVolume : (audioTtsPath ? 0.10 : 0.20);
  const volTts = Number.isFinite(ttsVolume) && ttsVolume !== null ? ttsVolume : 1.8;
  
  if (audioTtsPath) {
    // Audio music fade and low volume (default 0.10).
    layers.push(`[1:a]volume=${volMusic.toFixed(2)},afade=t=out:st=${fadeStart.toFixed(3)}:d=2[music]`);
    // Audio TTS volume y velocidad (atempo) + adelay (si aplica, multiplicamos en milisegundos)
    let audioFilters = `volume=${volTts.toFixed(2)}`;
    if (ttsSpeedFactor !== 1.0) audioFilters += `,atempo=${ttsSpeedFactor.toFixed(2)}`;
    if (introOffset > 0) audioFilters += `,adelay=${introOffset * 1000}|${introOffset * 1000}`;
    
    layers.push(`[2:a]${audioFilters}[speech]`);
    // Mezcla asimetrica, duration=first / longest, elegimos longest dado que ambos track tienen el largo. 
    layers.push(`[music][speech]amix=inputs=2:duration=longest[a]`);
    filterComplex = layers.join(";");
  } else {
    // Solo sonido de musica de fondo
    layers.push(`[1:a]volume=${volMusic.toFixed(2)},afade=t=out:st=${fadeStart.toFixed(3)}:d=2[a]`);
    filterComplex = layers.join(";");
  }

  const audioInputArgs = [
    "-stream_loop",
    "-1",
    "-ss",
    Math.max(0, audioStartSec).toFixed(3),
    "-i",
    audioPath,
  ];

  const ttsInputArgs = audioTtsPath ? [
    "-i",
    audioTtsPath,
  ] : [];

  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "info",
    "-loop",
    "1",
    "-t",
    durationSec.toFixed(3),
    "-i",
    imagePath,
    ...audioInputArgs,
    ...ttsInputArgs,
    ...(useIntro ? ["-i", logoPath] : []),
    ...(useWatermark ? ["-i", logoPath] : []),
    "-filter_complex",
    filterComplex,
    "-map",
    `[${finalVideoMap}]`,
    "-map",
    "[a]",
    "-t",
    durationSec.toFixed(3),
    "-r",
    String(config.fps),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await runFfmpeg(ffmpegArgs, "render");
  } catch (error) {
    const printable = toPrintableError(error);
    throw new BotError("VIDEO_RENDER_FAILED", "FFmpeg fallo durante el render del video.", {
      reason: printable.message,
      ffmpeg: printable.details || null,
      filterComplex,
      outputPath,
    });
  }
}

async function validateRenderedVideo(outputPath) {
  try {
    const stat = await fsp.stat(outputPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new BotError("VIDEO_EMPTY_OUTPUT", "El video generado esta vacio.", {
        outputPath,
        size: stat.size,
      });
    }
  } catch (error) {
    if (error instanceof BotError) throw error;
    throw new BotError("VIDEO_OUTPUT_NOT_FOUND", "No se encontro el archivo de salida.", {
      outputPath,
      reason: toPrintableError(error).message,
    });
  }
}

function runFfmpeg(argsList, label) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpegPath, argsList, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new BotError("FFMPEG_EXECUTION_ERROR", "No se pudo lanzar ffmpeg-static.", {
        reason: error.message,
      }));
      return;
    }

    let stderrLog = "";
    child.stderr.on("data", (chunk) => {
      const line = chunk.toString();
      stderrLog += line;
      const progress = line.match(/time=\s*([0-9:.]+)/);
      if (progress) {
        process.stdout.write(`[ffmpeg:${label}] ${progress[1]}\r`);
      }
    });

    child.on("error", (error) => {
      reject(new BotError("FFMPEG_EXECUTION_ERROR", "No se pudo ejecutar ffmpeg-static.", {
        reason: error.message,
      }));
    });

    child.on("close", (code) => {
      process.stdout.write("\n");
      if (code === 0) {
        resolve();
        return;
      }
      reject(new BotError("FFMPEG_EXIT_CODE", `FFmpeg finalizo con codigo ${code}.`, {
        code,
        stderr: clip(stderrLog, 5000),
      }));
    });
  });
}

async function requestWithRetry(fn, retryCount) {
  let attempt = 0;
  let lastError;
  while (attempt <= retryCount) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retryCount) break;
      const waitMs = 500 * (attempt + 1);
      await sleep(waitMs);
    }
    attempt += 1;
  }
  throw lastError;
}

async function ensureDirectories() {
  await Promise.all([
    fsp.mkdir(config.tmpAssetsDir, { recursive: true }),
    fsp.mkdir(config.outputDir, { recursive: true }),
    fsp.mkdir(config.musicDir, { recursive: true }),
    fsp.mkdir(config.fontsDir, { recursive: true }),
  ]);
}

async function listAudioFiles(directory) {
  const results = [];
  await walk(directory, results);
  return results.filter((file) => /\.(mp3|wav|m4a|aac)$/i.test(file));
}

async function walk(directory, collector) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, collector);
      continue;
    }
    if (entry.isFile()) collector.push(absolute);
  }
}

async function cleanupTempFiles(filePaths) {
  await Promise.all(filePaths.map(async (filePath) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fsp.rm(filePath, { force: true });
        return;
      } catch (error) {
        if (attempt === 2) {
          console.warn(`[warn] No se pudo borrar temporal ${filePath}: ${error.message}`);
          return;
        }
        await sleep(300);
      }
    }
  }));
}

function ensureFfmpegAvailable() {
  if (!ffmpegPath || typeof ffmpegPath !== "string") {
    throw new BotError("FFMPEG_STATIC_NOT_FOUND", "No se encontro ffmpeg-static. Ejecuta npm install.");
  }
}

function normalizeUrl(input) {
  return String(input || "").replace(/\/+$/, "");
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatSafe(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function hexToAssColor(hexColor) {
  const clean = String(hexColor || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "&H0015CCFA";
  const rr = clean.slice(0, 2).toUpperCase();
  const gg = clean.slice(2, 4).toUpperCase();
  const bb = clean.slice(4, 6).toUpperCase();
  return `&H00${bb}${gg}${rr}`;
}

function resolveTitleFontPath() {
  const fallbackCandidates = [
    config.titleFontFile,
    path.join(config.fontsDir, "Montserrat-Bold.ttf"),
    path.join(config.fontsDir, "Roboto-Black.ttf"),
    "C:/Windows/Fonts/montserrat-bold.ttf",
    "C:/Windows/Fonts/Roboto-Black.ttf",
    "C:/Windows/Fonts/ariblk.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
  ].filter(Boolean);

  for (const candidate of fallbackCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "C:/Windows/Fonts/arialbd.ttf";
}

function pickRandomImageMotion(totalFrames, tuning = {}) {
  const safeFrames = Math.max(totalFrames, 1);
  const zoomMax = clampNumber(tuning.zoomMax, 1.10, 1.20);
  const zoomMin = clampNumber(tuning.zoomMin, 1.01, zoomMax - 0.01);
  const zoomStep = ((zoomMax - zoomMin) / safeFrames).toFixed(9);
  const horizontalTravel = `on/${safeFrames}`;
  const reverseHorizontalTravel = `(1-on/${safeFrames})`;
  const panZoom = clampNumber(tuning.panZoom, 1.04, 1.14);

  const profiles = [
    {
      name: "zoom_in_center",
      z: `min(zoom+${zoomStep},${zoomMax.toFixed(3)})`,
      x: "iw/2-(iw/zoom/2)",
      y: "ih/2-(ih/zoom/2)",
    },
    {
      name: "zoom_out_center",
      z: `if(eq(on,1),${zoomMax.toFixed(3)},max(zoom-${zoomStep},${zoomMin.toFixed(3)}))`,
      x: "iw/2-(iw/zoom/2)",
      y: "ih/2-(ih/zoom/2)",
    },
    {
      name: "pan_left_to_right",
      z: `min(zoom+${zoomStep},${zoomMax.toFixed(3)})`,
      x: `(iw-iw/zoom)*${horizontalTravel}`,
      y: "(ih-ih/zoom)/2",
    },
    {
      name: "pan_right_to_left",
      z: `min(zoom+${zoomStep},${zoomMax.toFixed(3)})`,
      x: `(iw-iw/zoom)*${reverseHorizontalTravel}`,
      y: "(ih-ih/zoom)/2",
    },
    {
      name: "pan_top_to_bottom",
      z: `min(zoom+${zoomStep},${zoomMax.toFixed(3)})`,
      x: "(iw-iw/zoom)/2",
      y: `(ih-ih/zoom)*${horizontalTravel}`,
    },
  ];

  return chooseRandom(profiles);
}

function wrapWordsStrict(words, maxCharsPerLine) {
  const lines = [];
  let current = "";

  for (const word of words) {
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
  return lines;
}

function compressTitleLines(lines, maxCharsPerLine, maxLines) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  const cutoff = Math.max(5, maxCharsPerLine - 1);
  kept[maxLines - 1] = `${last.slice(0, cutoff).trimEnd()}...`;
  return kept;
}

function estimateTitleLineWidth(line, fontSize) {
  let width = 0;
  for (const char of String(line || "")) {
    if (char === " ") {
      width += fontSize * 0.30;
      continue;
    }
    if (/[ilI1'\-]/.test(char)) {
      width += fontSize * 0.33;
      continue;
    }
    if (/[MWÑÁÉÍÓÚÜ@#%&]/.test(char)) {
      width += fontSize * 0.86;
      continue;
    }
    if (/[A-Z]/.test(char)) {
      width += fontSize * 0.70;
      continue;
    }
    width += fontSize * 0.60;
  }
  return width + (fontSize * 0.45);
}

function buildTitleLayout(title, tuning = {}) {
  const clean = normalizeWhitespace(stripHtmlToText(title));
  if (!clean) return { text: "", fontSize: 0 };

  const titleMaxWordLength = clampNumber(tuning.titleMaxWordLength, 10, 30);
  const titleWidthRatio = clampNumber(tuning.titleWidthRatio, 0.65, 1);
  const titleMaxCharsPerLine = clampNumber(tuning.titleMaxCharsPerLine, 10, 120);
  const titleMaxLines = clampNumber(tuning.titleMaxLines, 1, 6);
  const forcedFontSize = clampNumber(config.titleForceFontSize, 0, 180);
  const hardMinFontSize = 6;
  const titleFontMax = forcedFontSize > 0
    ? forcedFontSize
    : clampNumber(tuning.titleFontSize, 8, config.titleFontSize);
  const fitWidthMode = Boolean(config.titleFitWidth);
  const fitWidthMaxFont = Math.max(titleFontMax, Math.round(config.width * 0.12));
  const titleFontMinPreferred = forcedFontSize > 0
    ? hardMinFontSize
    : clampNumber(tuning.titleMinFontSize, hardMinFontSize, titleFontMax);

  const words = clean
    .split(" ")
    .filter(Boolean)
    .flatMap((word) => splitLongWordStrict(word, titleMaxWordLength));
  const singleLineText = words.join(" ");
  const widthLimit = Math.floor(config.width * titleWidthRatio);
  const widthSafety = Math.floor(widthLimit * 0.88); // Añadimos padding para que no toque los bordes
  const charFactor = 0.85; // Aumentamos factor de seguridad por caracter

  // Prioriza una sola linea: reduce font-size antes de partir en multiples lineas.
  for (let fontSize = (fitWidthMode ? fitWidthMaxFont : titleFontMax); fontSize >= titleFontMinPreferred; fontSize -= 1) {
    if (estimateTitleLineWidth(singleLineText, fontSize) <= widthSafety) {
      return { text: singleLineText, fontSize };
    }
  }

  for (let fontSize = titleFontMax; fontSize >= titleFontMinPreferred; fontSize -= 1) {
    const computedMaxChars = Math.max(
      10,
      Math.floor(widthLimit / (fontSize * charFactor)),
    );
    const maxCharsPerLine = titleWidthRatio >= 0.99
      ? computedMaxChars
      : Math.min(titleMaxCharsPerLine, computedMaxChars);
    const lines = wrapWordsStrict(words, maxCharsPerLine);
    if (
      lines.length <= titleMaxLines
      && lines.every((line) => line.length <= maxCharsPerLine)
      && lines.every((line) => estimateTitleLineWidth(line, fontSize) <= widthSafety)
    ) {
      return { text: lines.join("\n"), fontSize };
    }
  }

  const fallbackFontSize = titleFontMinPreferred;
  const fallbackChars = Math.max(10, Math.floor(widthLimit / (fallbackFontSize * charFactor)));
  const fallbackLines = wrapWordsStrict(words, fallbackChars);

  return {
    text: fallbackLines.join("\n"),
    fontSize: fallbackFontSize,
  };
}

function escapeTextForDrawtext(input) {
  return String(input || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\r?\n/g, "\\\\n");
}

function parseResolutionValue(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase().replace(/p$/, "");
  const value = Number.parseInt(normalized, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new BotError("INVALID_RESOLUTION", `Resolucion invalida: ${rawValue}`);
  }
  return value;
}

function extractResolutionFromNpmConfigArgv() {
  const raw = process.env.npm_config_argv;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const original = Array.isArray(parsed?.original) ? parsed.original : [];
    const numeric = original.find((token) => /^\d+$/.test(String(token || "").trim()));
    return numeric ? parseResolutionValue(numeric) : null;
  } catch (error) {
    return null;
  }
}

function ensureEvenDimension(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  const safe = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return safe % 2 === 0 ? safe : safe + 1;
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function getRenderTuning(currentConfig) {
  const widthScale = clampNumber(currentConfig.width / 1080, 0.32, 1);
  const lowResFactor = clampNumber((720 - currentConfig.width) / 360, 0, 1);
  const hasTitleFontOverride = String(process.env.TITLE_FONT_SIZE || "").trim() !== "";
  const hasTitleMinFontOverride = String(process.env.TITLE_MIN_FONT_SIZE || "").trim() !== "";
  const hasTitleMaxCharsOverride = String(process.env.TITLE_MAX_CHARS_PER_LINE || "").trim() !== "";
  const hasSubtitleFontOverride = String(process.env.SUBTITLE_FONT_SIZE || "").trim() !== "";

  const subtitleFontSize = hasSubtitleFontOverride
    ? clampNumber(parseInt(process.env.SUBTITLE_FONT_SIZE), 12, 200)
    : clampNumber(
      Math.round(currentConfig.subtitleFontSize * widthScale),
      26,
      currentConfig.subtitleFontSize,
    );
  const subtitleOutline = clampNumber(
    Math.round(currentConfig.subtitleOutline * widthScale),
    2,
    currentConfig.subtitleOutline,
  );
  const subtitleShadow = clampNumber(
    Math.round(currentConfig.subtitleShadow * widthScale),
    1,
    currentConfig.subtitleShadow,
  );
  const subtitleMaxCharsPerLine = clampNumber(
    Math.round(currentConfig.subtitleMaxCharsPerLine * widthScale * 1.08),
    24,
    currentConfig.subtitleMaxCharsPerLine,
  );

  const subtitleMaxWordsPerChunk = clampNumber(
    Math.round(currentConfig.subtitleMaxWordsPerChunk * 1.18),
    currentConfig.subtitleMinWordsPerChunk + 2,
    36,
  );
  const subtitleMinWordsPerChunk = clampNumber(
    Math.round(currentConfig.subtitleMinWordsPerChunk * 1.16),
    10,
    subtitleMaxWordsPerChunk - 2,
  );

  const wordsPerSecond = clampNumber(
    currentConfig.wordsPerSecond * (0.86 - (lowResFactor * 0.04)),
    1.35,
    currentConfig.wordsPerSecond,
  );

  return {
    subtitleFontSize,
    subtitleOutline,
    subtitleShadow,
    subtitleMaxCharsPerLine,
    subtitleMaxWordsPerChunk,
    subtitleMinWordsPerChunk,
    wordsPerSecond,
    titleFontSize: hasTitleFontOverride
      ? clampNumber(currentConfig.titleFontSize, 12, 180)
      : clampNumber(Math.round(currentConfig.titleFontSize * widthScale), 42, currentConfig.titleFontSize),
    titleMinFontSize: hasTitleMinFontOverride
      ? clampNumber(currentConfig.titleMinFontSize, 10, 180)
      : clampNumber(Math.round(currentConfig.titleMinFontSize * widthScale), 38, currentConfig.titleMinFontSize),
    titleWidthRatio: clampNumber(currentConfig.titleWidthRatio, 0.75, 1),
    titleLineSpacing: clampNumber(Math.round(currentConfig.titleLineSpacing * widthScale), 2, currentConfig.titleLineSpacing),
    titleMaxCharsPerLine: hasTitleMaxCharsOverride
      ? clampNumber(currentConfig.titleMaxCharsPerLine, 12, 160)
      : clampNumber(
        Math.round(currentConfig.titleMaxCharsPerLine * (1 - (lowResFactor * 0.12))),
        12,
        Math.max(currentConfig.titleMaxCharsPerLine, 80),
      ),
    titleMaxLines: currentConfig.titleMaxLines,
    titleMaxWordLength: clampNumber(currentConfig.titleMaxWordLength - (lowResFactor >= 0.5 ? 1 : 0), 12, currentConfig.titleMaxWordLength),
    titleYRatio: clampNumber(currentConfig.titleYRatio + 0.015, 0.08, 0.18),
    fgHeightRatio: clampNumber(0.82 - (lowResFactor * 0.07), 0.74, 0.82),
    fgSharpen: clampNumber(0.52 + (lowResFactor * 0.20), 0.50, 0.80),
    bgBlurRadius: process.env.BG_BLUR_RADIUS ? parseInt(process.env.BG_BLUR_RADIUS) : clampNumber(Math.round(26 * widthScale), 10, 26),
    bgBlurPower: process.env.BG_BLUR_POWER ? parseInt(process.env.BG_BLUR_POWER) : clampNumber(Math.round(3 * widthScale), 2, 3),
    bgBrightness: process.env.BG_BRIGHTNESS ? parseFloat(process.env.BG_BRIGHTNESS) : clampNumber(-0.50 + (lowResFactor * 0.08), -0.50, -0.38),
    zoomMin: process.env.ZOOM_MIN ? parseFloat(process.env.ZOOM_MIN) : clampNumber(1.01 + (lowResFactor * 0.01), 1.01, 1.03),
    zoomMax: process.env.ZOOM_MAX ? parseFloat(process.env.ZOOM_MAX) : clampNumber(1.18 - (lowResFactor * 0.05), 1.12, 1.18),
    panZoom: process.env.PAN_ZOOM ? parseFloat(process.env.PAN_ZOOM) : clampNumber(1.12 - (lowResFactor * 0.04), 1.08, 1.12),
    customVideoPipeline: process.env.CUSTOM_VIDEO_PIPELINE || "",
  };
}

function resolveRequestedResolution({ cliResolution, envWidth, envHeight }) {
  if (cliResolution !== null && cliResolution !== undefined) {
    const preset = RESOLUTION_PRESETS[cliResolution];
    if (!preset) {
      throw new BotError(
        "INVALID_RESOLUTION",
        `Resolucion no soportada: ${cliResolution}. Usa 360, 480, 720 o 1080.`,
      );
    }
    return preset;
  }

  const width = ensureEvenDimension(envWidth, 1080);
  const height = ensureEvenDimension(envHeight, 1920);
  return {
    width,
    height,
    label: `${width}x${height}`,
  };
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    skipTts: false,
    testTts: false,
    postId: null,
    help: false,
    resolution: null,
    musicVolume: null,
    ttsVolume: null,
  };
  const positional = [];

  for (const argument of argv) {
    if (argument === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (argument === "--skip-tts") {
      parsed.skipTts = true;
      continue;
    }
    if (argument === "--test-tts") {
      parsed.testTts = true;
      continue;
    }
    if (argument.startsWith("--music-volume=")) {
      parsed.musicVolume = Number.parseFloat(argument.split("=")[1]);
      continue;
    }
    if (argument.startsWith("--tts-volume=")) {
      parsed.ttsVolume = Number.parseFloat(argument.split("=")[1]);
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument.startsWith("--post-id=")) {
      const value = Number.parseInt(argument.split("=")[1], 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new BotError("INVALID_ARGUMENT", `--post-id invalido: ${argument}`);
      }
      parsed.postId = value;
      continue;
    }
    if (argument.startsWith("--resolution=")) {
      parsed.resolution = parseResolutionValue(argument.split("=")[1]);
      continue;
    }
    if (/^\d+$/.test(argument)) {
      positional.push(argument);
      continue;
    }
    throw new BotError("INVALID_ARGUMENT", `Argumento no reconocido: ${argument}`);
  }

  if (positional.length > 1) {
    throw new BotError("INVALID_ARGUMENT", "Solo puedes pasar una resolucion numerica (ej: 480).");
  }
  if (positional.length === 1) {
    parsed.resolution = parseResolutionValue(positional[0]);
  }
  if (parsed.resolution === null) {
    parsed.resolution = extractResolutionFromNpmConfigArgv();
  }

  return parsed;
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname || "";
    const extension = path.extname(pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/i.test(extension)) return extension;
  } catch (error) {
    return "";
  }
  return "";
}

function chooseRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBetween(min, max) {
  const lower = Number.isFinite(min) ? min : 0;
  const upper = Number.isFinite(max) ? max : lower;
  if (upper <= lower) return lower;
  return lower + (Math.random() * (upper - lower));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clip(input, maxLength) {
  if (typeof input !== "string") return "";
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}...`;
}

function toPrintableError(error) {
  if (!error) return { message: "Error desconocido." };
  if (error instanceof BotError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (axios.isAxiosError(error)) {
    return {
      code: "AXIOS_ERROR",
      message: error.message,
      details: {
        status: error.response?.status,
        data: error.response?.data,
      },
    };
  }
  return {
    code: error.code || "UNHANDLED_ERROR",
    message: error.message || String(error),
  };
}

if (args.help) {
  console.log("Uso:");
  console.log("  node generar-video.js [360|480|720|1080] [--dry-run] [--post-id=123]");
  console.log("  node generar-video.js --resolution=480 [--dry-run]");
  console.log("  npm run generar-video -- 480");
  console.log("");
  console.log("Flags:");
  console.log("  --dry-run        Genera video pero no marca el post como procesado.");
  console.log("  --post-id=ID     Fuerza el procesamiento de un post puntual.");
  console.log("  360/480/720/1080 Preset vertical 9:16. 360=>360x640, 480=>480x854.");
  process.exit(0);
} else {
  main();
}
