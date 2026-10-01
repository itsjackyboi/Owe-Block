// Shared helpers for tools/smoke.mjs and tools/sim.mjs: Playwright loader and a static server that mounts the repo under /Owe-Block/.
import { spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', join(process.execPath, '..', '..', 'lib', 'node_modules', 'playwright', 'index.mjs')];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const spec = c.startsWith('/') ? pathToFileURL(c).href : createRequire(import.meta.url).resolve(c);
      const m = await import(spec);
      return m.chromium ? m : m.default;
    } catch { /* try next */ }
  }
  throw new Error('Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs');
}

// Serve the repo under /Owe-Block/ so a GitHub Pages subpath is exercised (all asset paths must be relative).
export async function startSite(port) {
  const siteRoot = mkdtempSync(join(tmpdir(), 'oweblock-'));
  symlinkSync(root, join(siteRoot, 'Owe-Block'));
  const server = spawn('http-server', [siteRoot, '-p', String(port), '-c-1', '-s'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  return { base: `http://localhost:${port}/Owe-Block/`, stop: () => server.kill() };
}
