const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3005;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Memory state
let isRunning = false;
let batchState = {
  total: 0,
  current: 0,
  status: 'Idle', // 'Idle', 'Running', 'Cooldown', 'Finished', 'Error'
  logs: []
};

// Helper to add log
function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${msg}`;
  batchState.logs.push(logMsg);
  if (batchState.logs.length > 200) batchState.logs.shift();
  console.log(logMsg);
}

// Function to run a single video generation
function runSingleGen(originalConfig) {
  return new Promise((resolve, reject) => {
    // Clonamos configuración para no afectar otros videos del lote
    const config = { ...originalConfig };

    // Si está en modo azar, elegimos un preset aleatorio antes de lanzar
    if (config.activePipelineName === "random" && config.savedPipelines) {
      const presets = Object.keys(config.savedPipelines);
      if (presets.length > 0) {
        const picked = presets[Math.floor(Math.random() * presets.length)];
        config.customVideoPipeline = config.savedPipelines[picked];
        addLog(`[MODO AZAR] Pipeline para este video: "${picked}"`);
      }
    }

    // Si está en modo azar de intro, decidimos 50/50
    if (config.enableIntroLogo === "random") {
      const picked = Math.random() > 0.5;
      config.enableIntroLogo = picked ? "true" : "false";
      addLog(`[MODO AZAR] Intro para este video: ${picked ? "SÍ" : "NO"}`);
    }

    addLog(`>>> Iniciando generacion en resolucion ${config.resolution}p...`);
    
    const args = ['generar-video.js', config.resolution];
    if (config.skipTts) args.push('--skip-tts');
    if (config.testTts) args.push('--test-tts');
    if (config.musicVolume !== undefined && config.musicVolume !== null && config.musicVolume !== "") args.push(`--music-volume=${config.musicVolume}`);
    if (config.ttsVolume !== undefined && config.ttsVolume !== null && config.ttsVolume !== "") args.push(`--tts-volume=${config.ttsVolume}`);
    
    const runEnv = { ...process.env };
    
    // Inject arbitrary config keys as exact ENV variables
    for (const [key, val] of Object.entries(config)) {
      if (['resolution', 'batchQuantity', 'delaySecs', 'skipTts', 'savedPipelines'].includes(key)) continue;
      if (val !== undefined && val !== null && val !== '') {
        const envKey = key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();
        runEnv[envKey] = val.toString();
      }
    }

    const child = spawn('node', args, {
      cwd: path.resolve(__dirname, '..'), // Run from root dir
      env: runEnv,
      shell: true
    });

    child.stdout.on('data', (data) => {
      const texts = data.toString().split('\n');
      texts.forEach(t => { if(t.trim()) addLog(`[CMD] ${t.trim()}`); });
    });

    child.stderr.on('data', (data) => {
      const texts = data.toString().split('\n');
      texts.forEach(t => { if(t.trim()) addLog(`[ERR] ${t.trim()}`); });
    });

    child.on('close', (code) => {
      if (code === 0) {
        addLog(`>>> Video generado exitosamente (Code 0).`);
        resolve();
      } else {
        addLog(`>>> Fallo o termino con codigo ${code}.`);
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

// Orchestrator loop
async function runBatchLogic(config) {
  isRunning = true;
  batchState.logs = [];
  batchState.total = config.batchQuantity;
  batchState.current = 0;
  batchState.status = 'Running';

  addLog(`--- INICIANDO LOTE DE ${config.batchQuantity} VIDEOS ---`);

  for (let i = 1; i <= config.batchQuantity; i++) {
    batchState.current = i;
    batchState.status = 'Running';
    
    try {
      addLog(`==> Procesando video ${i} de ${config.batchQuantity}`);
      await runSingleGen(config);
      
      if (i < config.batchQuantity) {
        batchState.status = 'Cooldown';
        addLog(`Esperando ${config.delaySecs} segundos antes del siguiente...`);
        await new Promise(res => setTimeout(res, config.delaySecs * 1000));
      }
    } catch (e) {
      addLog(`Error en el video ${i}: ${e.message}. Continuando con el siguiente en ${config.delaySecs} segs...`);
      batchState.status = 'Cooldown';
      await new Promise(res => setTimeout(res, config.delaySecs * 1000));
    }
  }

  batchState.status = 'Finished';
  isRunning = false;
  addLog(`--- LOTE FINALIZADO ---`);
}

const server = http.createServer((req, res) => {
  // CORS headers for flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints
  if (req.url === '/api/config' && req.method === 'GET') {
    fs.readFile(CONFIG_FILE, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Config invalida' }));
      }
    });
    return;
  }

  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isRunning,
      state: batchState
    }));
    return;
  }

  if (req.url === '/api/start' && req.method === 'POST') {
    if (isRunning) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'El lote ya esta en ejecucion.' }));
      return;
    }
    
    fs.readFile(CONFIG_FILE, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: 'No se pudo leer configuracion.' }));
      }
      const config = JSON.parse(data);
      runBatchLogic(config); // runs async
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // Serve static UI
  if (req.method === 'GET') {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    // Simplistic static file server
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        res.end('404 Not Found');
        return;
      }
      const ext = path.extname(filePath);
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css'
      };
      
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(content);
      });
    });
  }
});

server.listen(PORT, () => {
  console.log(`[Batch Orchestrator] Servidor en ejecucion en http://localhost:${PORT}`);
  
  // Si se pasa el argumento --start por consola, iniciamos el lote inmediatamente
  if (process.argv.includes('--start')) {
    fs.readFile(CONFIG_FILE, 'utf8', (err, data) => {
      if (!err) {
        try {
          const config = JSON.parse(data);
          addLog("Iniciando lote por comando CLI (--start)");
          runBatchLogic(config);
        } catch(e) {
          console.error("Error al parsear config.json para auto-start:", e);
        }
      } else {
        console.error("No se pudo leer config.json para auto-start:", err);
      }
    });
  }
});
