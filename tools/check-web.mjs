// Prove locally that the Pages artifact is the app and not the repository.
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageWeb } from './stage-web.mjs';

const forbidden = [
  '.claude', '.dev.vars', '.env', '.git', '.github', '_site', 'club',
  'dist-native', 'ios', 'node_modules', 'package-lock.json', 'package.json',
  'playwright-report', 'playwright.config.mjs', 'test', 'test-results', 'tools',
];

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function filesBelow(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesBelow(join(dir, entry.name), name));
    else if (entry.isFile()) found.push(name);
    else throw new Error(`the staged payload contains a non-file: ${name}`);
  }
  return found.sort();
}

function localPath(url) {
  const clean = url.replace(/^\.\//, '').replace(/[?#].*$/, '');
  return clean || 'index.html';
}

const temp = await mkdtemp(join(tmpdir(), 'resonate-web-'));
const { out, release } = await stageWeb(join(temp, 'site'));
const files = await filesBelow(out);

for (const path of forbidden) {
  if (await exists(join(out, path))) throw new Error(`the web payload contains ${path}`);
}

for (const needed of [
  '.well-known/security.txt', 'CNAME', 'LICENSE', 'NOTICE', 'PRIVACY.md',
  'SECURITY.md', 'SPEC.md', 'SUPPORT.md', 'TERMS.md', 'index.html',
  'llms.txt', 'manifest.webmanifest', 'read.html', 'release.json', 'robots.txt',
  'sitemap.xml', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'js/agent.js',
]) {
  if (!files.includes(needed)) throw new Error(`the web payload is missing ${needed}`);
}

const manifest = JSON.parse(await readFile(join(out, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  if (!files.includes(localPath(icon.src))) throw new Error(`the manifest names missing ${icon.src}`);
}

const sw = await readFile(join(out, 'sw.js'), 'utf8');
const shell = [...(/const SHELL = \[([\s\S]*?)\n\];/.exec(sw)?.[1] || '')
  .matchAll(/^\s*[`'](\.\/[^`']*)[`'],/gm)].map((m) => m[1].replace('${V}', 'v=release'));
if (shell.length < 20) throw new Error(`the offline shell names only ${shell.length} files`);
for (const url of shell) {
  const file = localPath(url);
  if (!files.includes(file)) throw new Error(`the offline shell names missing ${url}`);
}

for (const page of ['index.html', 'read.html']) {
  const html = await readFile(join(out, page), 'utf8');
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(?:[a-z][\w+.-]*:|#)/i.test(ref)) continue;
    const file = localPath(ref);
    if (!files.includes(file)) throw new Error(`${page} names missing ${ref}`);
  }
}

const recorded = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
if (recorded.release !== release.release || recorded.sourceRevision !== release.sourceRevision) {
  throw new Error('release.json does not identify the staged source');
}
if (!/^[0-9a-f]{40}$/.test(recorded.sourceRevision)) throw new Error('release.json has no commit');
if ((await readFile(join(out, 'CNAME'), 'utf8')).trim() !== 'resonate.select') {
  throw new Error('the Pages artifact no longer names resonate.select');
}

console.log(`${files.length} public files staged; repository machinery absent`);
console.log(`release ${recorded.release} from ${recorded.sourceRevision.slice(0, 12)}`);
