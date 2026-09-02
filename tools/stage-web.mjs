// The public site is an allowlist, not the repository with remembered holes.
// A new directory is private until somebody deliberately puts it on this list.
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PUBLIC_MODULES = [
  'app.js',
  'canonical.js',
  'capture.js',
  'club.js',
  'evening.js',
  'exif.js',
  'find.js',
  'geocode.js',
  'kinship.js',
  'library.js',
  'letters.js',
  'agent.js',
  'map.js',
  'marks.js',
  'pairing.js',
  'photos.js',
  'read.js',
  'route.js',
  'schema.js',
  'share.js',
  'store.js',
];

export const PUBLIC_FILES = [
  'ASSISTANT-ACCESS.md',
  'CHALLENGE.md',
  'CNAME',
  'LICENSE',
  'METHOD.md',
  'NOTICE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TERMS.md',
  'THIRD-PARTY-LICENSES.md',
  'THREATS.md',
  'index.html',
  'llms.txt',
  'manifest.webmanifest',
  'read.html',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  ...PUBLIC_MODULES.map((file) => `js/${file}`),
];

export const PUBLIC_TREES = [
  '.well-known',
  'css',
  'fonts',
  'icons',
  'vendor',
];

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) await copyFile(source, target);
    else throw new Error(`the public payload refuses the non-file ${source}`);
  }
}

function sourceRevision() {
  const fromRunner = String(process.env.GITHUB_SHA || '').trim();
  if (/^[0-9a-f]{40}$/i.test(fromRunner)) return fromRunner.toLowerCase();
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function releaseWord() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  return /<meta name="resonate-release" content="([^"]+)">/.exec(html)?.[1] || 'unknown';
}

export async function stageWeb(output = join(root, '_site')) {
  const out = resolve(output);
  if (out === root || !['_site', 'site'].includes(basename(out))) {
    throw new Error(`refusing to replace a staging directory named ${basename(out) || '/'}`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const file of PUBLIC_FILES) {
    await mkdir(dirname(join(out, file)), { recursive: true });
    await copyFile(join(root, file), join(out, file));
  }
  for (const tree of PUBLIC_TREES) await copyTree(join(root, tree), join(out, tree));

  // The public specification is the one intentional exception to the club
  // directory staying private. Its served address has always been /SPEC.md.
  await copyFile(join(root, 'club', 'SPEC.md'), join(out, 'SPEC.md'));

  const release = {
    release: releaseWord(),
    sourceRevision: sourceRevision(),
  };
  await writeFile(join(out, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  return { out, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2]) throw new Error('web:stage always writes the repository _site directory');
  const output = join(root, '_site');
  const { release } = await stageWeb(output);
  console.log(`staged web release ${release.release} (${release.sourceRevision.slice(0, 12)}) at ${output}`);
}
