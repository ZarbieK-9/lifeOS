#!/usr/bin/env node
/**
 * One script to: check ports, start backend (Docker), wait for it, start ngrok, update frontend .env.
 * Run from project root: node scripts/start-backend-and-ngrok.js
 * Ctrl+C stops ngrok (and optionally bring down Docker with --down).
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

const root = path.resolve(__dirname, '..');
const infraDir = path.join(root, 'infra');
const frontendEnvPath = path.join(root, 'frontend', '.env');
const rootEnvPath = path.join(root, '.env');

const BACKEND_PORT = 8080;
const PORTS_TO_CHECK = [8080, 5432, 1883]; // Envoy, Postgres, MQTT

function log(msg) {
  console.log('[LifeOS]', msg);
}

function fail(msg) {
  console.error('[LifeOS]', msg);
  process.exit(1);
}

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));  // in use
    s.once('listening', () => {
      s.close();
      resolve(false);  // free
    });
    s.listen(port, '127.0.0.1');
  });
}

function waitForPort(port, timeoutMs = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Port ${port} not ready in time`));
        setTimeout(tryConnect, 2000);
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Port ${port} not ready in time`));
        setTimeout(tryConnect, 2000);
      });
      socket.connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

function getLocalIp() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function run(cmd, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

function loadRootEnv() {
  if (!fs.existsSync(rootEnvPath)) return {};
  const out = {};
  const content = fs.readFileSync(rootEnvPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function updateFrontendEnv(backendUrl) {
  if (!fs.existsSync(frontendEnvPath)) {
    log('No frontend/.env found, skipping update.');
    return;
  }
  let content = fs.readFileSync(frontendEnvPath, 'utf8');
  const line = /EXPO_PUBLIC_BACKEND_URL=.*/;
  if (line.test(content)) {
    content = content.replace(line, `EXPO_PUBLIC_BACKEND_URL=${backendUrl}`);
  } else {
    content = content.trimEnd() + `\nEXPO_PUBLIC_BACKEND_URL=${backendUrl}\n`;
  }
  fs.writeFileSync(frontendEnvPath, content, 'utf8');
  log('Updated frontend/.env with EXPO_PUBLIC_BACKEND_URL=' + backendUrl);
}

async function main() {
  log('Checking ports...');
  const port8080InUse = await checkPort(BACKEND_PORT);
  const port5432InUse = await checkPort(5432);
  const port1883InUse = await checkPort(1883);

  const localIp = getLocalIp();
  log(`Local IP: ${localIp}`);

  if (!port8080InUse) {
    log('Starting backend (Docker Compose)...');
    const hasCompose = fs.existsSync(path.join(infraDir, 'docker-compose.yml'));
    if (!hasCompose) fail('infra/docker-compose.yml not found.');
    try {
      await run('docker', ['compose', 'up', '-d'], infraDir);
    } catch (e) {
      try {
        await run('docker-compose', ['up', '-d'], infraDir);
      } catch (e2) {
        fail('Could not start Docker. Is Docker running? Try: cd infra && docker compose up -d');
      }
    }
    log('Waiting for backend on port ' + BACKEND_PORT + '...');
    await waitForPort(BACKEND_PORT);
    log('Backend is up.');
  } else {
    log('Port ' + BACKEND_PORT + ' already in use — assuming backend is running.');
  }

  const env = loadRootEnv();
  const token = env.NGROK_AUTHTOKEN || env.ngrok_key;
  if (!token) fail('Add NGROK_AUTHTOKEN= or ngrok_key= to project root .env');
  process.env.NGROK_AUTHTOKEN = token;

  log('Starting ngrok tunnel...');
  const ngrok = require('@ngrok/ngrok');
  const listener = await ngrok.forward({ addr: BACKEND_PORT, authtoken_from_env: true });
  const url = listener.url();

  updateFrontendEnv(url);

  const googleRedirect = url.replace(/\/+$/, '') + '/oauth/google/callback';
  console.log('');
  console.log('--- LifeOS backend + ngrok ready ---');
  console.log('  Backend (local):   http://' + localIp + ':' + BACKEND_PORT);
  console.log('  Backend (public):  ' + url);
  console.log('  Google redirect:  ' + googleRedirect);
  console.log('  frontend/.env:     EXPO_PUBLIC_BACKEND_URL updated.');
  console.log('');
  console.log('Restart Expo (npx expo start --clear) to use the new URL.');
  console.log('Press Ctrl+C to stop ngrok (Docker keeps running).');
  console.log('');

  process.stdin.resume();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
