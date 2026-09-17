#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';

const args = ['preview', '--host', '0.0.0.0', '--port', '3000'];

console.log('[Railway] Starting Vite preview server...');
console.log('[Railway] Command: vite', args.join(' '));
console.log('[Railway] CWD:', process.cwd());
console.log('[Railway] NODE_ENV:', process.env.NODE_ENV);

const vite = spawn('npx', ['vite', ...args], {
  cwd: path.join(process.cwd(), 'frontend'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
});

vite.on('error', (err) => {
  console.error('[Railway] Vite spawn error:', err);
  process.exit(1);
});

vite.on('exit', (code, signal) => {
  console.error(`[Railway] Vite process exited with code ${code}, signal ${signal}`);
  process.exit(code || 1);
});

process.on('SIGTERM', () => {
  console.log('[Railway] Received SIGTERM, terminating vite...');
  vite.kill('SIGTERM');
});

