// privacy-races.spec.mjs — outward boundaries under real cross-tab races.
//
// These tests deliberately keep two same-origin documents alive. A synthetic
// StorageEvent can exercise a listener, but it cannot prove that durable state
// written by another device-shaped page wins over a stale control, a pending
// local edit, or a tool object an assistant already captured.

import { test, expect } from '@playwright/test';

const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

async function bootAtlas(page, { agentAccess = false } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
  await page.addInitScript(({ access }) => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([{
      id: 'p0', name: 'Privacy Race Sentinel', lat: 47.5596, lng: 7.5886,
      city: 'Basel', country: 'Switzerland', tags: ['t1'], status: 'visited',
      note: '', createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't1', name: 'Nature', hue: 155, color: '#4a7' },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300, agentAccess: access,
    }));

    window.__shared = [];
    window.__copied = [];
    window.__printed = 0;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: data => { window.__shared.push(data); return Promise.resolve(); },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copied.push(String(text)); return Promise.resolve(); } },
    });
    window.print = () => { window.__printed += 1; };

    window.__agentTools = new Map();
    const context = {
      async registerTool(tool, { signal } = {}) {
        window.__agentTools.set(tool.name, tool);
        signal?.addEventListener('abort', () => {
          if (window.__agentTools.get(tool.name) === tool) window.__agentTools.delete(tool.name);
        }, { once: true });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true, get: () => context,
    });
  }, { access: agentAccess });

  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, { timeout: 15_000 });
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
}

async function peerPage(context) {
  const peer = await context.newPage();
  await peer.goto('/read.html');
  return peer;
}

async function showIndex(page) {
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
}

async function openComposer(page) {
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>folio');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await page.locator('#folNew').click();
  await expect(page.locator('#folTitle')).toBeVisible();
  await page.locator('#folTitle').fill('A tagged collection');
  await page.locator('.fol-row[data-fid="p0"]').click();
  await expect(page.locator('.fol-row[data-fid="p0"]')).toHaveAttribute('aria-pressed', 'true');
}

async function renameTag(peer, name) {
  await peer.evaluate((nextName) => {
    const tags = JSON.parse(localStorage.getItem('resonate.tags.v1') || '[]');
    const tag = tags.find(item => item.id === 't1');
    if (tag) tag.name = nextName;
    localStorage.setItem('resonate.tags.v1', JSON.stringify(tags));
  }, name);
}

test('a captured assistant tool fails closed after a real second page revokes access', async ({ page, context }) => {
  await bootAtlas(page, { agentAccess: true });
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()].sort())).toEqual([
    'atlas_overview', 'prepare_list', 'prepare_place', 'search_atlas', 'show_atlas_item',
  ]);
  await page.evaluate(() => { window.__capturedSearch = window.__agentTools.get('search_atlas'); });

  const peer = await peerPage(context);
  await peer.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
    settings.agentAccess = false;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(settings));
  });

  const call = await page.evaluate(async () => {
    try {
      const value = await window.__capturedSearch.execute({ query: 'Privacy Race Sentinel' });
      return { settled: 'resolved', value };
    } catch (error) {
      return { settled: 'rejected', name: error?.name, message: error?.message };
    }
  });
  expect(call.settled, 'a tool captured before revocation still returned atlas data').toBe('rejected');
  expect(call.name).toBe('AbortError');
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()]))
    .toEqual(['review_assistant_access']);
  await peer.close();
});

test('a pending note cannot overwrite a second page exclusion or escape through a stale share control', async ({ page, context }) => {
  await bootAtlas(page);
  await showIndex(page);
  await page.locator('.ix[data-id="p0"]').click();
  await expect(page.locator('#plate')).toBeVisible();
  await page.locator('#pNote').fill('A note still inside the write debounce.');
  // Keep the actual stale node, including its listener, even if the normal
  // storage-event repaint removes it before the test crosses back to this page.
  await page.evaluate(() => { window.__staleShareButton = document.querySelector('#pHand'); });

  const peer = await peerPage(context);
  await peer.evaluate(() => {
    const places = JSON.parse(localStorage.getItem('resonate.places.v1') || '[]');
    places[0].private = true;
    localStorage.setItem('resonate.places.v1', JSON.stringify(places));
  });
  await page.evaluate(() => window.__staleShareButton.click());

  await expect(page.locator('#toast')).toContainText('Excluded from sharing');
  expect(await page.evaluate(() => ({
    shared: window.__shared.length,
    copied: window.__copied.length,
  }))).toEqual({ shared: 0, copied: 0 });
  const durable = await peer.evaluate(() => JSON.parse(
    localStorage.getItem('resonate.places.v1') || '[]',
  )[0]);
  expect(durable.private, 'the pending note resurrected the stale public record').toBe(true);
  expect(durable.note, 'the durable privacy refresh discarded the pending local words')
    .toBe('A note still inside the write debounce.');
  await peer.close();
});

test('a tag renamed in a second page invalidates both collection sharing and printing reviews', async ({ page, context }) => {
  await bootAtlas(page);
  await openComposer(page);
  const peer = await peerPage(context);

  await page.locator('#folCopy').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askWhat')).toContainText('1 tag label');
  await renameTag(peer, 'Quiet places');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('This collection changed. Review it again');
  expect(await page.evaluate(() => ({
    shared: window.__shared.length,
    copied: window.__copied.length,
  }))).toEqual({ shared: 0, copied: 0 });

  await page.locator('#folPrint').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askWhat')).toContainText('1 tag label');
  await renameTag(peer, 'Even quieter places');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('This selection changed. Review it again');
  expect(await page.evaluate(() => window.__printed), 'a sheet with an unreviewed tag name reached print')
    .toBe(0);
  await peer.close();
});
