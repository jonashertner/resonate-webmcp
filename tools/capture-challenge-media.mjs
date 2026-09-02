// Capture the public WebMCP Challenge gallery from a clean, local Resonate.
//
// The browser shim is deliberately tiny: it supplies the proposed
// document.modelContext.registerTool host used by the browser test suite. The
// tools, consent boundary, returned data, and visible reviews are Resonate's
// production code.

import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'docs', 'challenge');
const BASE_URL = process.env.CHALLENGE_BASE_URL || 'http://localhost:5178/';
const MAX_BYTES = 5 * 1024 * 1024;
const STORY_ONLY = process.argv.includes('--story-only');

const DESKTOP = { width: 1500, height: 1000 };
const PHONE = { width: 390, height: 844 };

const files = {
  atlas: join(OUTPUT, '01-atlas-desktop.png'),
  consent: join(OUTPUT, '02-assistant-consent-desktop.png'),
  item: join(OUTPUT, '03-assistant-readonly-desktop.png'),
  draftDesktop: join(OUTPUT, '04-assistant-draft-desktop.png'),
  draftMobile: join(OUTPUT, '04-assistant-draft-mobile.png'),
};

function wait(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function isResonateReady() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    return (await response.text()).includes('<title>Resonate. A personal atlas</title>');
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isResonateReady()) return null;

  const server = spawn(process.execPath, [join(ROOT, 'tools', 'dev.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Local server stopped before it was ready.\n${output.trim()}`);
    }
    if (await isResonateReady()) return server;
    await wait(100);
  }

  server.kill('SIGTERM');
  throw new Error(`Timed out waiting for ${BASE_URL}.\n${output.trim()}`);
}

async function newContext(browser, { viewport, deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });

  await context.addInitScript(() => {
    window.__challengeAgentTools = new Map();
    const modelContext = {
      async registerTool(tool, { signal } = {}) {
        window.__challengeAgentTools.set(tool.name, tool);
        const unregister = () => {
          if (window.__challengeAgentTools.get(tool.name) === tool) {
            window.__challengeAgentTools.delete(tool.name);
          }
        };
        signal?.addEventListener('abort', unregister, { once: true });
        return unregister;
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true,
      get: () => modelContext,
    });
  });

  return context;
}

async function settle(page, { tiles = false } = {}) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  if (tiles) {
    await page.waitForFunction(
      () => document.querySelectorAll('.leaflet-tile-loaded').length > 0,
      null,
      { timeout: 6000 },
    ).catch(() => {});
  }
  await page.waitForTimeout(500);
}

async function hideToast(page) {
  await page.locator('#toast').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
}

async function adoptExampleAtlas(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#threshold').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#thFull').click();
  const report = page.getByRole('dialog', { name: 'Example atlas', exact: true });
  await report.waitFor({ state: 'visible', timeout: 10000 });
  await report.getByRole('button', { name: 'Use as my atlas', exact: true }).click();
  await report.waitFor({ state: 'hidden', timeout: 10000 });
  await page.waitForFunction(() => {
    try {
      return JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').length > 10;
    } catch {
      return false;
    }
  });
  await page.waitForFunction(() => window.__challengeAgentTools.has('review_assistant_access'));

  const privacy = await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
    return {
      authorName: settings.authorName || '',
      selectedExample: settings.seeded === true,
      storedPlaces: JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').length,
    };
  });
  if (privacy.authorName || !privacy.selectedExample || privacy.storedPlaces < 10) {
    throw new Error(`Capture profile was not the clean example atlas: ${JSON.stringify(privacy)}`);
  }
  if (errors.length) throw new Error(`Page error while opening the example atlas: ${errors.join('; ')}`);

  await hideToast(page);
  await settle(page, { tiles: true });
}

async function openAssistantAccess(page) {
  const result = await page.evaluate(() =>
    window.__challengeAgentTools.get('review_assistant_access').execute({}));
  if (!result?.ok || result?.data?.dataExposed !== false) {
    throw new Error(`Assistant review did not stay zero-data: ${JSON.stringify(result)}`);
  }
  await page.locator('#agentAccessOverlay').waitFor({ state: 'visible' });
  await settle(page);
}

async function allowAssistantAccess(page) {
  await page.locator('#agentReviewToggle').click();
  await page.waitForFunction(() => [
    'atlas_overview',
    'prepare_list',
    'prepare_place',
    'search_atlas',
    'show_atlas_item',
  ].every(name => window.__challengeAgentTools.has(name)));
  await page.keyboard.press('Escape');
  await page.locator('#agentAccessOverlay').waitFor({ state: 'hidden' });
  await hideToast(page);
}

async function martaParisResults(page) {
  const result = await page.evaluate(() =>
    window.__challengeAgentTools.get('search_atlas').execute({
      city: 'Paris', status: 'wishlist', recommended_by: 'Marta',
      kind: 'place', limit: 10,
    }));
  const names = result?.data?.results?.map(record => record.name).sort() || [];
  const hasMartaTrail = result?.data?.results?.every(record =>
    record.provenance?.some(step => step.name === 'Marta'));
  if (!result?.ok || result.data.matched !== 2
    || JSON.stringify(names) !== JSON.stringify(['Ogata', 'Septime'])
    || !hasMartaTrail) {
    throw new Error(`Expected exactly Ogata and Septime after Marta: ${JSON.stringify(result)}`);
  }
  return result.data.results;
}

async function openMartaParisDraft(page, results) {
  const itemIds = results.map(record => record.id);
  const drafted = await page.evaluate(selectedIds =>
    window.__challengeAgentTools.get('prepare_list').execute({
      title: "Marta's Paris",
      note: 'Lunch at Septime, then tea and art at Ogata.',
      item_ids: selectedIds,
    }), itemIds);
  if (!drafted?.ok || drafted.saved || drafted.shared
    || drafted.data.itemCount !== itemIds.length) {
    throw new Error(`Assistant collection draft crossed its review boundary: ${JSON.stringify(drafted)}`);
  }

  await page.locator('#folioOverlay').waitFor({ state: 'visible' });
  await page.locator('#folTitle').waitFor({ state: 'visible' });
  // Keep the canonical city on the first screenful. The draft still contains
  // the whole disclosure-safe pool; this visible filter changes no choice.
  await page.locator('#folFindItems').fill('Paris');
  await page.locator('#folCount').waitFor({ state: 'visible' });
  await page.waitForFunction(selected => document.querySelector('#folCount')?.textContent
    ?.includes(`${selected} selected`), itemIds.length);
  await page.locator('#folFindItems').evaluate(field => field.blur());
  await page.locator('#folioOverlay').evaluate(room => { room.scrollTop = 0; });
}

async function capture(page, path, { scale = 'css' } = {}) {
  await settle(page, { tiles: true });
  await page.screenshot({ path, fullPage: false, animations: 'disabled', scale });
}

function dimensionsOfPng(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Capture is not a PNG.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function verifyCapture(path, expected) {
  const info = await stat(path);
  const bytes = await readFile(path);
  const dimensions = dimensionsOfPng(bytes);
  if (info.size >= MAX_BYTES) {
    throw new Error(`${path} is ${(info.size / 1024 / 1024).toFixed(2)} MB; limit is under 5 MB.`);
  }
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
    throw new Error(`${path} is ${dimensions.width}x${dimensions.height}; expected ${expected.width}x${expected.height}.`);
  }
  return { path, bytes: info.size, ...dimensions };
}

async function captureDesktop(browser) {
  const context = await newContext(browser, { viewport: DESKTOP });
  const page = await context.newPage();
  try {
    await adoptExampleAtlas(page);

    if (!STORY_ONLY) {
      await page.locator('#fmIndex').click();
      await page.locator('#indexOverlay').waitFor({ state: 'visible' });
      await capture(page, files.atlas);
      await page.locator('#indexClose').click();
      await page.locator('#indexOverlay').waitFor({ state: 'hidden' });
    }

    await openAssistantAccess(page);
    if (!STORY_ONLY) await capture(page, files.consent);
    await allowAssistantAccess(page);

    const results = await martaParisResults(page);
    const choice = results.find(record => record.name === 'Ogata') || results[0];
    const opened = await page.evaluate(({ id, kind }) =>
      window.__challengeAgentTools.get('show_atlas_item').execute({ id, kind }), choice);
    if (!opened?.ok || opened.saved || opened.shared) {
      throw new Error(`Assistant item view crossed its read-only boundary: ${JSON.stringify(opened)}`);
    }
    await page.locator('#plate[aria-label="Assistant place"]').waitFor({ state: 'visible' });
    await capture(page, files.item);

    await page.locator('#aaiClose').click();
    await page.locator('#plate').waitFor({ state: 'hidden' });
    await openMartaParisDraft(page, results);
    await capture(page, files.draftDesktop);
  } finally {
    await context.close();
  }
}

async function captureMobile(browser) {
  const context = await newContext(browser, {
    viewport: PHONE,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await adoptExampleAtlas(page);
    await openAssistantAccess(page);
    await allowAssistantAccess(page);

    const results = await martaParisResults(page);
    await openMartaParisDraft(page, results);
    await capture(page, files.draftMobile, { scale: 'device' });
  } finally {
    await context.close();
  }
}

await mkdir(OUTPUT, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({ headless: true });

try {
  await captureDesktop(browser);
  await captureMobile(browser);
} finally {
  await browser.close();
  if (server) server.kill('SIGTERM');
}

const verified = [
  ...(STORY_ONLY ? [] : [
    await verifyCapture(files.atlas, DESKTOP),
    await verifyCapture(files.consent, DESKTOP),
  ]),
  await verifyCapture(files.item, DESKTOP),
  await verifyCapture(files.draftDesktop, DESKTOP),
  await verifyCapture(files.draftMobile, { width: PHONE.width * 2, height: PHONE.height * 2 }),
];

for (const item of verified) {
  const relative = item.path.slice(ROOT.length + 1);
  console.log(`${relative}  ${item.width}x${item.height}  ${(item.bytes / 1024).toFixed(1)} KB`);
}
