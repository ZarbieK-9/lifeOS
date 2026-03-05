#!/usr/bin/env node
/**
 * Expose local backend (port 8080) via ngrok using NGROK_AUTHTOKEN or ngrok_key from root .env.
 * No ngrok CLI needed. Run from project root: node scripts/ngrok-tunnel.js
 * Then set EXPO_PUBLIC_BACKEND_URL in frontend/.env to the https URL printed below.
 */

const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

if (!fs.existsSync(envPath)) {
  console.error('No .env in project root. Add NGROK_AUTHTOKEN= or ngrok_key= to .env');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^\s*(NGROK_AUTHTOKEN|ngrok_key)\s*=\s*(.+)\s*$/);
  if (m) {
    process.env.NGROK_AUTHTOKEN = m[2].trim().replace(/^["']|["']$/g, '');
    break;
  }
}

if (!process.env.NGROK_AUTHTOKEN) {
  console.error('Add NGROK_AUTHTOKEN= or ngrok_key= to .env');
  process.exit(1);
}

async function main() {
  const ngrok = require('@ngrok/ngrok');
  const listener = await ngrok.forward({ addr: 8080, authtoken_from_env: true });
  const url = listener.url();
  console.log('');
  console.log('ngrok tunnel ready');
  console.log('  Backend URL:', url);
  console.log('');
  console.log('1. In frontend/.env set:  EXPO_PUBLIC_BACKEND_URL=' + url);
  console.log('2. In Google Console add redirect URI:  ' + url + '/oauth/google/callback');
  console.log('');
  console.log('Press Ctrl+C to stop the tunnel.');
  process.stdin.resume();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
