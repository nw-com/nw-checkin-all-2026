const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = v;
    if (v !== 'true') i++;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function writeEnvFile(outdir, sessionId, apiUrl) {
  const envPath = path.join(outdir, `${sessionId}.env`);
  fs.writeFileSync(envPath, `DEBUG_SERVER_URL=${apiUrl}\nDEBUG_SESSION_ID=${sessionId}\n`, 'utf8');
  return envPath;
}

function dataUrlSafeJsonParse(str) {
  try { return JSON.parse(str || '{}'); } catch { return null; }
}

function main() {
  const args = parseArgs(process.argv);
  const sessionId = String(args.session || '').trim();
  if (!sessionId) {
    process.stderr.write('Missing --session\n');
    process.exit(2);
  }

  const outdir = String(args.outdir || '.dbg').trim() || '.dbg';
  const startPort = Math.max(1, parseInt(String(args.port || '7777'), 10) || 7777);
  const idleSec = Math.max(0, parseInt(String(args.idle || '0'), 10) || 0);
  const clean = String(args.clean || 'false') === 'true';
  const remote = String(args.remote || 'false') === 'true';

  ensureDir(outdir);
  const logFile = path.join(outdir, `trae-debug-log-${sessionId}.ndjson`);
  if (clean) fs.writeFileSync(logFile, '', 'utf8');

  const host = remote ? '0.0.0.0' : '127.0.0.1';
  const displayHost = remote ? getLocalIp() : '127.0.0.1';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  let lastSeen = Date.now();
  let server = null;
  let port = startPort;

  const handler = (req, res) => {
    if (!req || !req.url) {
      res.writeHead(400, corsHeaders);
      res.end('bad request');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: true, sessionId, ts: Date.now() }));
      return;
    }

    if (url.pathname !== '/event') {
      res.writeHead(404, corsHeaders);
      res.end('not found');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end('');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        res.writeHead(413, corsHeaders);
        res.end('payload too large');
        req.destroy();
      }
    });

    req.on('end', () => {
      lastSeen = Date.now();
      const event = dataUrlSafeJsonParse(body);
      if (!event) {
        res.writeHead(400, corsHeaders);
        res.end('bad json');
        return;
      }
      const normalized = {
        sessionId,
        runId: event.runId || 'pre-fix',
        hypothesisId: event.hypothesisId || 'A',
        msg: event.msg || '',
        ts: typeof event.ts === 'number' ? event.ts : Date.now(),
        data: event.data || {},
      };
      fs.appendFileSync(logFile, `${JSON.stringify(normalized)}\n`, 'utf8');
      res.writeHead(200, corsHeaders);
      res.end('ok');
    });
  };

  for (let i = 0; i < 10; i++) {
    try {
      server = http.createServer(handler);
      server.listen(port, host);
      break;
    } catch (_) {
      port += 1;
    }
  }

  if (!server) {
    process.stderr.write('Failed to bind port\n');
    process.exit(3);
  }

  const apiUrl = `http://${displayHost}:${port}/event`;
  const envFile = writeEnvFile(outdir, sessionId, apiUrl);

  console.log('@@DEBUG_SERVER_INFO');
  console.log(JSON.stringify({
    api_url: apiUrl,
    session_id: sessionId,
    log_dir: path.resolve(outdir),
    log_file: path.resolve(logFile),
    env_file: path.resolve(envFile),
  }, null, 2));
  console.log('@@END_DEBUG_SERVER_INFO');

  if (idleSec > 0) {
    const timer = setInterval(() => {
      if (Date.now() - lastSeen > idleSec * 1000) {
        clearInterval(timer);
        server.close(() => process.exit(0));
      }
    }, 1000);
  }
}

main();

