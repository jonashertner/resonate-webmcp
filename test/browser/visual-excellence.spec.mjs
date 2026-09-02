// visual-excellence.spec.mjs — objective guards for the composed interface.
//
// Screenshot diffs are poor judges of a living map. These tests hold the
// relationships that make the typography calm instead: words stay inside
// their columns, first actions stay above the fold, temporary notices stay on
// the glass, and persistent chrome never sits beneath a side plate.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5178';
const OFF = [
  '**://*.cartocdn.com/**',
  '**://*.openstreetmap.org/**',
  '**://tile.**',
  '**://photon.komoot.io/**',
  '**://nominatim.openstreetmap.org/**',
];
const API_HOSTS = ['photon.komoot.io', 'nominatim.openstreetmap.org'];

async function cutTheWorld(page) {
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
  await page.addInitScript((hosts) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input?.url;
      let url = null;
      try { url = new URL(href, location.href); } catch { /* not a URL */ }
      if (url && hosts.includes(url.host)) {
        return Promise.reject(new TypeError('the world is cut in this test'));
      }
      return realFetch(input, init);
    };
  }, API_HOSTS);
}

async function seedReturningAtlas(page) {
  await page.addInitScript(() => {
    const now = '2026-08-31T12:00:00.000Z';
    localStorage.setItem('resonate.places.v1', JSON.stringify([
      {
        id: 'p-reading',
        name: 'The Reading Room beside the old botanical garden',
        lat: 47.558, lng: 7.588, city: 'Basel', country: 'Switzerland',
        tags: ['t-culture'], status: 'visited',
        note: 'A quiet table, forgiving light, and enough time to finish the chapter.',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'p-river', name: 'Rheinbad Breite',
        lat: 47.561, lng: 7.605, city: 'Basel', country: 'Switzerland',
        tags: ['t-water'], status: 'wishlist', note: '',
        createdAt: now, updatedAt: now,
      },
    ]));
    localStorage.setItem('resonate.routes.v1', JSON.stringify([{
      id: 'r-river', name: 'Along the river and through the old city',
      path: [{ lat: 47.558, lng: 7.588 }, { lat: 47.561, lng: 7.605 }],
      city: 'Basel', country: 'Switzerland', tags: ['t-water'],
      status: 'walked', note: 'Best before the streets become busy, when the water is still and every turn through the old city remains easy to follow.',
      createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.books.v1', JSON.stringify([{
      id: 'b-cities', title: 'Invisible Cities', author: 'Italo Calvino',
      year: '1972', tags: ['t-culture'], status: 'visited',
      note: 'Cities as memory, desire, signs, and exchange, with a different passage worth returning to after every journey.',
      createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't-culture', name: 'Culture', hue: 155, color: '#4a7' },
      { id: 't-water', name: 'Water', hue: 205, color: '#2786a8' },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300, clubUrl: 'http://localhost:5179',
    }));
  });
}

async function pageAt(browser, viewport, { returning = true, hasTouch = false } = {}) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
    hasTouch,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cutTheWorld(page);
  if (returning) await seedReturningAtlas(page);
  await page.goto('/');

  if (returning) {
    await expect(page.locator('#threshold')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('body')).toHaveAttribute('data-entry', /^(?:board|field)$/, {
      timeout: 15_000,
    });
    await expect(page.locator('#indexOverlay')).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.locator('#threshold')).toBeVisible({ timeout: 15_000 });
  }
  return { context, page };
}

async function expectNoHorizontalOverflow(page, label, selectors = []) {
  const measurements = await page.evaluate((extra) => {
    const entries = [
      ['html', document.documentElement],
      ['body', document.body],
      ...extra.map(selector => [selector, document.querySelector(selector)]),
    ];
    return entries.filter(([, element]) => element).map(([selector, element]) => ({
      selector,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
  }, selectors);

  const leaking = measurements.filter(({ clientWidth, scrollWidth }) =>
    scrollWidth > clientWidth + 1).filter(({ overflowX }) =>
    !['hidden', 'clip'].includes(overflowX));
  expect(leaking, `${label} has horizontal overflow: ${JSON.stringify(leaking)}`).toEqual([]);
}

async function expectInsideViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} has no rendered box`).not.toBeNull();
  expect(box.x, `${label} begins left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} begins above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} ends right of the viewport`)
    .toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} ends below the viewport`)
    .toBeLessThanOrEqual(viewport.height + 1);
  return box;
}

async function expectHorizontallyInsideViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} has no rendered box`).not.toBeNull();
  expect(box.x, `${label} begins left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} ends right of the viewport`)
    .toBeLessThanOrEqual(viewport.width + 1);
  return box;
}

function overlap(a, b) {
  return {
    width: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
    height: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
  };
}

for (const viewport of [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
]) {
  test(`the first action remains whole on a ${viewport.width}px first visit`, async ({ browser }) => {
    const { context, page } = await pageAt(browser, viewport, {
      returning: false,
      hasTouch: true,
    });
    try {
      const threshold = page.locator('#threshold');
      await expectInsideViewport(page.locator('#thWhat'), viewport, 'the opening promise');
      await expectInsideViewport(page.locator('#thEmpty'), viewport, 'the first action');
      await expect(threshold.locator('.th-privacy')).not.toHaveAttribute('open', '');
      await expectNoHorizontalOverflow(page, `the ${viewport.width}px first visit`, ['#threshold']);
    } finally {
      await context.close();
    }
  });

  test(`atlas words neither collide nor leave the glass at ${viewport.width}px`, async ({ browser }) => {
    const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
    try {
      const geometry = await page.locator('#indexGo').evaluate((nav) => {
        const rect = element => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return [...nav.querySelectorAll('button')].map(button => ({
          name: button.textContent.trim(),
          button: rect(button),
          word: rect(button.querySelector('.go-word')),
        }));
      });

      const escaped = geometry.filter(({ button, word }) =>
        word.left < button.left - 1 || word.right > button.right + 1
        || word.top < button.top - 1 || word.bottom > button.bottom + 1);
      expect(escaped, 'a room name escaped the button column that owns it').toEqual([]);

      const collisions = [];
      for (let i = 0; i < geometry.length; i += 1) {
        for (let j = i + 1; j < geometry.length; j += 1) {
          const shared = overlap(geometry[i].word, geometry[j].word);
          if (shared.width > 0.75 && shared.height > 0.75) {
            collisions.push([geometry[i].name, geometry[j].name, shared]);
          }
        }
      }
      expect(collisions, 'two room names occupy the same pixels').toEqual([]);

      for (const selector of ['#indexClose', '#indexGo', '#kindSeg', '#statusSeg']) {
        await expectInsideViewport(page.locator(selector).first(), viewport, selector);
      }
      // Records belong to the board's vertical scroll, but never to a hidden
      // horizontal continuation of it.
      await expectHorizontallyInsideViewport(page.locator('.ix-row').first(), viewport, '.ix-row');
      await expectNoHorizontalOverflow(page, `the atlas at ${viewport.width}px`, ['#indexOverlay']);
    } finally {
      await context.close();
    }
  });
}

test('wide first visits use two calm columns without losing a choice', async ({ browser }) => {
  for (const viewport of [
    { width: 1180, height: 650 },
    { width: 1440, height: 800 },
    { width: 1600, height: 900 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, { returning: false });
    try {
      const promise = await expectInsideViewport(
        page.locator('#thWhat'), viewport, 'the opening promise',
      );
      for (const [selector, label] of [
        ['#thEmpty', 'the first-atlas choice'],
        ['#thFull', 'the example-atlas choice'],
        ['#thImport', 'the file-restore choice'],
        ['#thMember', 'the club-restore choice'],
        ['#thPrivacy', 'the privacy disclosure'],
        ['.th-full', 'the example disclosure'],
        ['#thHow', 'the explanation link'],
      ]) {
        await expectInsideViewport(page.locator(selector), viewport, label);
      }

      const choices = await page.locator('#thEmpty').boundingBox();
      expect(choices.x, 'the decision column collides with the opening promise')
        .toBeGreaterThan(promise.x + promise.width + 24);
      await expectNoHorizontalOverflow(
        page,
        `the ${viewport.width}×${viewport.height} first visit`,
        ['#threshold', '.th-go'],
      );
    } finally {
      await context.close();
    }
  }
});

test('short wide first visits never lose their opening above the scroll origin', async ({ browser }) => {
  for (const viewport of [
    { width: 1180, height: 550 },
    { width: 1440, height: 500 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, { returning: false });
    try {
      await expectInsideViewport(page.locator('#thWhat'), viewport, 'the opening promise');
      const threshold = page.locator('#threshold');
      const scroll = await threshold.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(scroll.scrollHeight, 'the short first visit has no reachable continuation')
        .toBeGreaterThan(scroll.clientHeight);

      await threshold.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => threshold.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectInsideViewport(page.locator('#thHow'), viewport, 'the explanation link');
      await expectInsideViewport(page.locator('.th-full'), viewport, 'the example disclosure');
      await expectNoHorizontalOverflow(
        page,
        `the short ${viewport.width}×${viewport.height} first visit`,
        ['#threshold', '.th-go'],
      );
    } finally {
      await context.close();
    }
  }
});

test('a landscape phone offers a useful first action without scrolling', async ({ browser }) => {
  for (const viewport of [
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 932, height: 430 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, {
      returning: false,
      hasTouch: true,
    });
    try {
      await expectInsideViewport(page.locator('#thWhat'), viewport, 'the opening promise');
      await expectInsideViewport(page.locator('#thEmpty'), viewport, 'the first action');
      await expectNoHorizontalOverflow(
        page,
        `the ${viewport.width}×${viewport.height} landscape first visit`,
        ['#threshold', '.th-go'],
      );
    } finally {
      await context.close();
    }
  }
});

test('revisited help keeps its way back visible on a short landscape phone', async ({ browser }) => {
  const viewport = { width: 653, height: 280 };
  const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
  try {
    await page.locator('#indexClose').click();
    await page.locator('#fmHelp').click();
    await expect(page.locator('#threshold')).toBeVisible();
    await expectInsideViewport(page.locator('#thBack'), viewport, 'the way back');
    await expect(page.locator('#thBack')).toBeFocused();
    await expectNoHorizontalOverflow(page, 'the short landscape help', ['#threshold']);
  } finally {
    await context.close();
  }
});

test('settings reflow cleanly at the wide-layout boundary', async ({ browser }) => {
  for (const viewport of [
    { width: 1179, height: 720 },
    { width: 1180, height: 720 },
    { width: 1280, height: 720 },
  ]) {
    const { context, page } = await pageAt(browser, viewport);
    try {
      await page.locator('[data-go="you"]').click();
      await expect(page.locator('#settingsOverlay')).toBeVisible();
      for (const [selector, label] of [
        ['#settingsOverlay .poster-head', 'the settings title'],
        ['#settingsBody', 'the settings body'],
        ['#authorNameHelp', 'the sharing-name explanation'],
        ['#assistantSettings > summary', 'the assistant-access row'],
      ]) {
        await expectHorizontallyInsideViewport(
          page.locator(selector), viewport, `${label} at ${viewport.width}px`,
        );
      }
      await expectNoHorizontalOverflow(
        page,
        `settings at the ${viewport.width}px wide-layout boundary`,
        ['#settingsOverlay', '#settingsBody', '.set-name-row'],
      );
    } finally {
      await context.close();
    }
  }
});

test('settings survive WCAG text spacing on a narrow phone', async ({ browser }) => {
  const viewport = { width: 320, height: 568 };
  const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
  try {
    await page.locator('[data-go="you"]').click();
    await page.locator('#settingsOverlay').evaluate((room) => {
      const style = document.createElement('style');
      style.dataset.audit = 'wcag-text-spacing';
      style.textContent = `
        #settingsOverlay * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }
        #settingsOverlay p { margin-bottom: 2em !important; }
      `;
      room.append(style);
    });

    const room = page.locator('#settingsOverlay');
    await expectNoHorizontalOverflow(
      page,
      'settings under WCAG text spacing',
      ['#settingsOverlay', '#settingsBody', '.set-name-row'],
    );
    await expectInsideViewport(
      page.locator('#settingsOverlay .poster-x'), viewport, 'the spaced settings close control',
    );
    await room.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => room.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expectInsideViewport(page.locator('.set-footer'), viewport, 'the settings footer');
    await expectInsideViewport(
      page.locator('#settingsOverlay .poster-x'), viewport, 'the close control after scrolling',
    );
  } finally {
    await context.close();
  }
});

test('long notices stay contained in short and keyboard-sized viewports', async ({ browser }) => {
  for (const viewport of [
    { width: 667, height: 280 },
    { width: 280, height: 200 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
    try {
      await page.evaluate(() => {
        const toast = document.querySelector('#toast');
        toast.replaceChildren();
        toast.className = 'toast mono has-action';
        const copy = document.createElement('span');
        copy.className = 'toast-copy';
        copy.textContent = 'This browser could not finish the change. Everything you had is still here, and nothing was sent or removed. Make room on this device, then try again.';
        const action = document.createElement('button');
        action.className = 'toast-act';
        action.type = 'button';
        action.textContent = 'take it back';
        toast.append(copy, action);
        toast.hidden = false;
      });

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expectInsideViewport(toast, viewport, `the notice at ${viewport.width}×${viewport.height}`);
      const scroll = await toast.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(
        scroll.scrollHeight <= scroll.clientHeight + 1 || ['auto', 'scroll'].includes(scroll.overflowY),
        'a notice clips vertically without offering its own scroll',
      ).toBe(true);
      await expect(toast.getByRole('button', { name: 'take it back' })).toBeVisible();
      await expectNoHorizontalOverflow(page, `the ${viewport.width}×${viewport.height} notice`, ['#toast']);
    } finally {
      await context.close();
    }
  }
});

test('a tablet side plate leaves the persistent command in the open field', async ({ browser }) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
    try {
      await page.locator('button.ix').first().click();
      await expect(page.locator('#plate')).toBeVisible();

      const geometry = await page.evaluate(() => {
        const box = selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return { plate: box('#plate'), command: box('#fmCommand') };
      });
      const shared = overlap(geometry.plate, geometry.command);
      expect(shared.width * shared.height,
        `the command overlaps the side plate at ${viewport.width}×${viewport.height}`)
        .toBe(0);

      await expectInsideViewport(page.locator('#plate'), viewport, 'the side plate');
      const name = await page.locator('#plate .plate-name').boundingBox();
      expect(name.x, 'the plate title escaped to the left').toBeGreaterThanOrEqual(geometry.plate.left - 1);
      expect(name.x + name.width, 'the plate title escaped to the right')
        .toBeLessThanOrEqual(geometry.plate.right + 1);
      await expectNoHorizontalOverflow(page, `the tablet plate at ${viewport.width}px`, ['#plate']);
    } finally {
      await context.close();
    }
  }
});

test('saved notes reveal every line on narrow phones', async ({ browser }) => {
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 320, height: 568 },
  ]) {
    const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
    try {
      for (const [door, note] of [
        ['[data-id="p-reading"]', '#pNote'],
        ['[data-rid="r-river"]', '#pRouteNote'],
        ['[data-bid="b-cities"]', '#pBookNote'],
      ]) {
        if (await page.locator('#indexOverlay').isHidden()) {
          await page.locator('#fmIndex').click();
          await expect(page.locator('#indexOverlay')).toBeVisible();
        }
        await page.locator(door).click();
        await expect(page.locator(note)).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const size = await page.locator(note).evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY,
        }));
        expect(size.clientHeight, `${note} hides saved lines at ${viewport.width}px`)
          .toBeGreaterThanOrEqual(size.scrollHeight - 1);
        expect(size.overflowY, `${note} creates a nested phone scrollbar`).toBe('hidden');
        await page.locator('#pClose').click();
        await expect(page.locator('#plate')).toBeHidden();
      }
    } finally {
      await context.close();
    }
  }
});

test('a short desktop opens with a useful first atlas row', async ({ browser }) => {
  const viewport = { width: 1440, height: 500 };
  const { context, page } = await pageAt(browser, viewport);
  try {
    const geometry = await page.evaluate(() => {
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        header: box('.index-head'),
        tools: box('.index-tools'),
        first: box('.index-list .ix-row'),
      };
    });
    expect(geometry.header.bottom, 'the working filters overlap the masthead')
      .toBeLessThanOrEqual(geometry.tools.top + 1);
    expect(geometry.tools.bottom, 'the first record begins beneath the filters')
      .toBeLessThanOrEqual(geometry.first.top + 1);

    const visibleHeight = Math.max(0,
      Math.min(viewport.height, geometry.first.bottom) - Math.max(0, geometry.first.top));
    expect(visibleHeight, 'less than one touch-sized band of the first record is visible')
      .toBeGreaterThanOrEqual(Math.min(44, geometry.first.height) - 1);
    await expectNoHorizontalOverflow(page, 'the short desktop atlas', ['#indexOverlay']);
  } finally {
    await context.close();
  }
});

test('forced colours retain focus and pressed-state geometry', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced-colours emulation is a Chromium contract');
  const viewport = { width: 1024, height: 768 };
  const { context, page } = await pageAt(browser, viewport);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    const room = page.locator('#indexGo button').first();
    await room.focus();
    const focus = await room.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        colour: style.outlineColor,
      };
    });
    expect(focus.style, 'forced colours removed the focus outline').not.toBe('none');
    expect(focus.width, 'the forced-colours focus outline is too faint geometrically')
      .toBeGreaterThanOrEqual(2);
    expect(focus.colour, 'the forced-colours focus outline became transparent')
      .not.toBe('rgba(0, 0, 0, 0)');

    await page.locator('#statusWant').click();
    await expect(page.locator('#statusWant')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#statusAll')).toHaveAttribute('aria-pressed', 'false');
    const states = await page.evaluate(() => ({
      pressed: getComputedStyle(document.querySelector('#statusWant')).textDecorationLine,
      resting: getComputedStyle(document.querySelector('#statusAll')).textDecorationLine,
    }));
    expect(states.pressed, 'pressed state has no non-colour cue').toContain('underline');
    expect(states.resting, 'an unpressed state looks pressed').not.toContain('underline');
    await expectNoHorizontalOverflow(page, 'the atlas in forced colours', ['#indexOverlay']);
  } finally {
    await context.close();
  }
});

test('editable metadata is explicit, bounded, and not artificially numeric', async ({ browser }) => {
  const { context, page } = await pageAt(browser, { width: 280, height: 653 }, { hasTouch: true });
  try {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
    await page.locator('#fmCommand').click();
    await expect(page.locator('#paletteOverlay')).toBeVisible();
    await page.locator('#paletteInput').fill('>tags');
    await page.keyboard.press('Enter');
    await expect(page.locator('#tagsOverlay')).toBeVisible();
    for (const name of ['Culture', 'Water']) {
      await expect(page.getByRole('button', { name: `Rename ${name}`, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: `Recolour ${name}`, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
    }
    await page.locator('#tagsOverlay .poster-x').click();

    await page.locator('#fmIndex').click();
    await expect(page.locator('#indexOverlay')).toBeVisible();
    await page.locator('[data-go="you"]').click();
    const sharingName = page.locator('#authorName');
    await expect(sharingName).toHaveAttribute('maxlength', '60');
    await sharingName.fill('a'.repeat(80));
    await sharingName.press('Tab');
    expect((await sharingName.inputValue()).length, 'the sharing name exceeds its outbound limit').toBe(60);
    const savedName = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('resonate.settings.v1')).authorName);
    expect(savedName.length, 'the stored sharing name exceeds its outbound limit').toBe(60);
    await page.locator('#settingsOverlay .poster-x').click();

    await page.locator('[data-bid="b-cities"]').click();
    const edition = page.locator('#pBookYear');
    await expect(edition).toHaveAttribute('maxlength', '60');
    await expect(edition).not.toHaveAttribute('inputmode', 'numeric');
    await edition.fill('second revised edition');
    const editionWidth = await edition.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(editionWidth.scrollWidth, 'a valid edition is hidden inside a four-digit field')
      .toBeLessThanOrEqual(editionWidth.clientWidth + 1);
    await edition.press('Tab');
    await page.locator('#pClose').click();
    await page.locator('#fmIndex').click();
    await expect(page.locator('#indexOverlay')).toBeVisible();
    await page.locator('[data-bid="b-cities"]').click();
    await expect(page.locator('#pBookYear')).toHaveValue('second revised edition');
  } finally {
    await context.close();
  }
});

test('destructive decisions favour safety and keep undo in the active room', async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
  try {
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type="module"]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.load();
      store.addCorrespondent({ name: 'Mira', tags: [], places: [
        { id: 'm1', name: 'One', lat: 47, lng: 9, city: 'Basel', country: 'Switzerland', status: 'visited', tags: [] },
      ] });
    });
    await page.locator('[data-go="contacts"]').click();
    const row = page.locator('.corr-row', { hasText: 'Mira' });
    await expect(row).toHaveAttribute('open', '');
    await row.locator('[data-part]').click();

    await expect(page.locator('#askBox')).toHaveAttribute('role', 'alertdialog');
    await expect(page.locator('#askNo')).toBeFocused();
    const decisionColours = await page.evaluate(() => ({
      danger: getComputedStyle(document.querySelector('#askGo')).color,
      safe: getComputedStyle(document.querySelector('#askNo')).color,
    }));
    expect(decisionColours.danger, 'the destructive verb is visually indistinguishable')
      .not.toBe(decisionColours.safe);
    await page.locator('#askGo').click();

    const undo = page.locator('#toast .toast-act');
    await expect(undo).toBeVisible();
    await expect(page.locator('#contactsOverlay > #toast')).toHaveCount(1);
    await expectInsideViewport(page.locator('#toast'), viewport, 'the modal undo notice');
    await page.locator('#contactsOverlay').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(undo, 'the modal focus cycle cannot reach undo').toBeFocused();
    await undo.click();
    await expect(page.locator('.corr-row', { hasText: 'Mira' })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('People keeps its two primary sharing paths visible after an atlas is followed', async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const { context, page } = await pageAt(browser, viewport, { hasTouch: true });
  try {
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type="module"]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.load();
      store.addCorrespondent({ name: 'Mira', tags: [], places: [
        { id: 'm1', name: 'One', lat: 47, lng: 9, city: 'Basel', country: 'Switzerland', status: 'visited', tags: [] },
      ] });
    });
    await page.locator('[data-go="contacts"]').click();

    await expect(page.getByRole('heading', { name: 'atlases you follow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'share my atlas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'open atlas link' })).toBeVisible();
    await expect(page.locator('.corr-row', { hasText: 'Mira' })).toBeVisible();
    await expectInsideViewport(page.locator('.people-doors'), viewport, 'the persistent People actions');
  } finally {
    await context.close();
  }
});

test('an example map preview becomes the map, not a title-sized backdrop', async ({ browser }) => {
  const { context, page } = await pageAt(browser, { width: 390, height: 844 }, {
    returning: false,
    hasTouch: true,
  });
  try {
    await page.locator('#thFull').click();
    await expect(page.locator('#reportOverlay')).toBeVisible();
    await page.locator('#rpField').click();
    await expect(page.locator('#visitBar')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/\bhero\b/);
    const word = await page.locator('.fm-word').evaluate((element) => ({
      size: parseFloat(getComputedStyle(element).fontSize),
      width: element.getBoundingClientRect().width,
    }));
    expect(word.size, 'the hero word remains title-sized over the preview').toBeLessThan(40);
    expect(word.width, 'the home word consumes most of the phone width').toBeLessThan(180);
  } finally {
    await context.close();
  }
});

test('club payment preflight is announced while the join is unavailable', async ({ browser }) => {
  const { context, page } = await pageAt(browser, { width: 390, height: 844 }, { hasTouch: true });
  try {
    await page.route('**/desk', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ live: false, ready: true, price: null }),
      });
    });
    await page.locator('[data-go="you"]').click();
    await page.locator('#clubWord').click();
    const desk = page.locator('#clubDesk');
    await expect(desk).toHaveAttribute('role', 'status');
    await expect(desk).toHaveAttribute('aria-busy', 'true');
    await expect(desk).toContainText('checking payment mode');
    await expect(page.locator('#clubJoin')).toBeDisabled();
    await expect(desk).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#clubJoin')).toBeEnabled();
  } finally {
    await context.close();
  }
});
