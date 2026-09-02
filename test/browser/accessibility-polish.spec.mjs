// accessibility-polish.spec.mjs — small contracts for the controls that look
// like type, and for the compact dialogs that sit outside the poster stack.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5178';
const OFF = [
  '**://*.cartocdn.com/**',
  '**://*.openstreetmap.org/**',
  '**://tile.**',
  '**://photon.komoot.io/**',
  '**://nominatim.openstreetmap.org/**',
];

async function cutTheWorld(page) {
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
}

async function makePage(browser, {
  viewport = { width: 390, height: 844 },
  hasTouch = true,
  returning = true,
  places = 4,
} = {}) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
    hasTouch,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cutTheWorld(page);
  await page.addInitScript(({ returning: isReturning, n }) => {
    if (!isReturning) return;
    const now = '2026-09-02T10:00:00.000Z';
    localStorage.setItem('resonate.places.v1', JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        name: `Place ${i}`,
        lat: 47.55 + i * 0.01,
        lng: 7.58 + i * 0.01,
        city: 'Basel',
        country: 'Switzerland',
        tags: ['t1'],
        status: 'visited',
        note: '',
        createdAt: now,
        updatedAt: now,
      })),
    ));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't1', name: 'Culture', hue: 155, color: '#4a7' },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto',
      chosen: true,
      seeded: true,
      introSeen: true,
      authorName: 'ada',
      hue: 300,
    }));
  }, { returning, n: places });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15_000 });
  if (returning) {
    await expect(page.locator('body')).toHaveAttribute('data-entry', /^(?:board|field)$/, {
      timeout: 15_000,
    });
    if (await page.locator('#indexOverlay').isVisible()) {
      await page.locator('#indexClose').click();
      await expect(page.locator('#indexOverlay')).toBeHidden();
    }
  } else {
    await expect(page.locator('#threshold')).toBeVisible({ timeout: 15_000 });
  }
  return { context, page };
}

async function showIndex(page) {
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
}

async function addPeople(page) {
  return page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type="module"]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    // Direct connections are intentionally not rendered until this device has
    // an identity. The crypto itself is irrelevant to a name-field test.
    store.setIdentity({ jwk: { kty: 'OKP' }, pub: 'this-device' });
    const pair = store.addPair({
      id: 'pair-a', name: 'Ada', cap: 'invitation-a', state: 'introduced',
    });
    const voice = store.addCorrespondent({
      name: 'Mira', tags: [], places: [
        { id: 'm1', name: 'A shared place', lat: 47.57, lng: 7.6, city: 'Basel', tags: [] },
      ],
    });
    return { pair: pair.id, voice: voice.id };
  });
}

async function incomingFolioUrl(page, author = 'bruno') {
  return page.evaluate(async (from) => {
    const v = new URL(document.querySelector('script[type="module"]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    store.load();
    return makeFolioUrl({
      title: 'Two of mine', dedication: 'for you', author: from,
      tags: [], places: store.places.slice(0, 2),
    });
  }, author);
}

async function openPeople(page) {
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();
  await expect(page.locator('#contactsOverlay')).toBeVisible();
}

async function savedName(page, kind, id) {
  return page.evaluate(({ kind: which, id: wanted }) => {
    if (which === 'pair') {
      const letters = JSON.parse(localStorage.getItem('resonate.letters.v1'));
      return letters.pairs.find(person => person.id === wanted)?.name;
    }
    const voices = JSON.parse(localStorage.getItem('resonate.correspondents.v1'));
    return voices.find(person => person.id === wanted)?.name;
  }, { kind, id });
}

async function expectCompactDialog(page, selector) {
  const dialog = page.locator(selector);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleName(/\S/);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  expect(await dialog.evaluate(root => root.contains(document.activeElement)),
    `${selector} did not receive focus`).toBe(true);

  const controls = dialog.locator('a[href]:visible, button:not([disabled]):visible');
  expect(await controls.count(), `${selector} has no focus loop`).toBeGreaterThan(1);
  await controls.last().focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(root => root.contains(document.activeElement)),
    `Tab escaped ${selector}`).toBe(true);
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(root => root.contains(document.activeElement)),
    `Shift+Tab escaped ${selector}`).toBe(true);
}

async function hurryDeferredDismissals(page) {
  await page.evaluate(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) => nativeTimeout(
      callback, delay >= 1000 ? 10 : delay, ...args,
    );
  });
}

test('People names read and behave as full-size single-line fields', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    await addPeople(page);
    await openPeople(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    for (const selector of ['.pair-name[contenteditable]', '.corr-name[contenteditable]']) {
      const field = page.locator(selector);
      await field.scrollIntoViewIfNeeded();
      await expect(field).toHaveAttribute('role', 'textbox');
      await expect(field).toHaveAttribute('aria-multiline', 'false');
      await expect(field).toHaveAccessibleName(/name/i);
      const appearance = await field.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const ruled = style.borderBottomStyle !== 'none'
          && Number.parseFloat(style.borderBottomWidth) > 0
          && style.borderBottomColor !== 'rgba(0, 0, 0, 0)';
        return {
          cursor: style.cursor,
          height: box.height,
          hasRestingAffordance: ruled || style.boxShadow !== 'none'
            || style.textDecorationLine.includes('underline'),
        };
      });
      expect(appearance.cursor, `${selector} does not look editable`).toBe('text');
      expect(appearance.hasRestingAffordance, `${selector} has no resting field cue`).toBe(true);
      expect(appearance.height, `${selector} is smaller than a coarse-pointer target`)
        .toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});

test('People name edits commit with Enter and undo Escape or an empty blur', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    const ids = await addPeople(page);
    await openPeople(page);
    const cases = [
      { kind: 'pair', selector: '.pair-name[contenteditable]', next: 'Ada Lovelace' },
      { kind: 'voice', selector: '.corr-name[contenteditable]', next: 'Mira Bell' },
    ];

    for (const item of cases) {
      let field = page.locator(item.selector);
      await field.fill(item.next);
      await field.press('Enter');
      expect(await savedName(page, item.kind, ids[item.kind])).toBe(item.next);
      field = page.locator(item.selector);
      await expect(field).toHaveText(item.next);

      await field.fill('Throwaway name');
      await field.press('Escape');
      field = page.locator(item.selector);
      await expect(field).toHaveText(item.next);
      expect(await savedName(page, item.kind, ids[item.kind])).toBe(item.next);
      await expect(page.locator('#contactsOverlay')).toBeVisible();

      await field.fill('');
      await field.blur();
      field = page.locator(item.selector);
      await expect(field).toHaveText(item.next);
      expect(await savedName(page, item.kind, ids[item.kind])).toBe(item.next);
    }
  } finally {
    await context.close();
  }
});

test('the answer-with-three bar is a persistent focus-holding dialog', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    const url = await incomingFolioUrl(page);
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20_000 });
    await hurryDeferredDismissals(page);
    await page.locator('#rpLeave').click();
    await expectCompactDialog(page, '#answerBar');
    await page.waitForTimeout(150);
    await expect(page.locator('#answerBar')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a fallback thanks dialog yields cleanly back to its report', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    const url = await incomingFolioUrl(page, 'mira');
    await page.goto('about:blank');
    await page.goto(url);
    const report = page.locator('#reportOverlay');
    await expect(report).toBeVisible({ timeout: 20_000 });

    const thank = report.locator('[data-thank]').first();
    await hurryDeferredDismissals(page);
    await thank.click();

    const hand = page.locator('#handBar');
    await expectCompactDialog(page, '#handBar');
    expect(await hand.getAttribute('inert')).toBeNull();
    expect(await hand.getAttribute('aria-hidden')).toBeNull();
    await expect(report).toHaveAttribute('inert', '');
    await expect(report).toHaveAttribute('aria-hidden', 'true');
    expect(await report.getAttribute('aria-modal')).toBeNull();
    await expect(hand.locator('#hbDone')).toBeEnabled();

    await hand.locator('#hbDone').click();
    await expect(hand).toBeHidden();
    await expect(report).toBeVisible();
    await expect(report).toHaveAttribute('role', 'dialog');
    await expect(report).toHaveAttribute('aria-modal', 'true');
    expect(await report.getAttribute('inert')).toBeNull();
    expect(await report.getAttribute('aria-hidden')).toBeNull();
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    const restored = await report.evaluate((root) => {
      const active = document.activeElement;
      const box = active.getBoundingClientRect();
      const room = root.getBoundingClientRect();
      return {
        inside: active === root || root.contains(active),
        visible: box.top >= room.top - 1 && box.bottom <= room.bottom + 1,
      };
    });
    expect(restored.inside, 'focus did not return to the report').toBe(true);
    expect(restored.visible, 'restored report focus is off-screen').toBe(true);
    await page.keyboard.press('Tab');
    expect(await report.evaluate(root => root.contains(document.activeElement)),
      'the restored report did not accept focus').toBe(true);

    const last = report.locator('a[href]:visible, button:not([disabled]):visible').last();
    await last.focus();
    await page.keyboard.press('Tab');
    expect(await report.evaluate(root => root.contains(document.activeElement)),
      'focus escaped the restored report').toBe(true);
  } finally {
    await context.close();
  }
});

test('share choices remain in a persistent focus-holding dialog', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    await showIndex(page);
    await page.locator('.ix[data-id]').first().click();
    await expect(page.locator('#plate')).toBeVisible();
    await hurryDeferredDismissals(page);
    await page.locator('#pHand').click();
    await expectCompactDialog(page, '#handBar');
    await page.waitForTimeout(150);
    await expect(page.locator('#handBar')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('compact colour and coordinate controls name their actions and values', async ({ browser }) => {
  const { context, page } = await makePage(browser);
  try {
    await showIndex(page);
    const colour = page.locator('#fieldWord');
    const firstWord = (await colour.textContent()).trim();
    await expect(colour).toHaveAccessibleName(new RegExp(`interface colour.*${firstWord}.*change`, 'i'));
    await colour.click();
    const nextWord = (await colour.textContent()).trim();
    expect(nextWord).not.toBe(firstWord);
    await expect(colour).toHaveAccessibleName(new RegExp(`interface colour.*${nextWord}.*change`, 'i'));

    await page.locator('.ix[data-id]').first().click();
    const coordinates = page.locator('#pCoords');
    await expect(coordinates).toBeVisible();
    await expect(coordinates).toHaveAccessibleName(/^copy coordinates:\s*\S/i);
  } finally {
    await context.close();
  }
});

test('short screens keep threshold and restored collection-search focus visible', async ({ browser }) => {
  const fresh = await makePage(browser, {
    viewport: { width: 653, height: 280 }, returning: false,
  });
  try {
    const threshold = fresh.page.locator('#threshold');
    await expect(threshold).toBeFocused();
    const focus = await threshold.evaluate((root) => {
      const element = document.activeElement;
      const box = element.getBoundingClientRect();
      const room = root.getBoundingClientRect();
      return {
        scrollTop: root.scrollTop,
        inside: root.contains(element),
        visible: box.top >= room.top - 1 && box.bottom <= room.bottom + 1,
      };
    });
    expect(focus.inside).toBe(true);
    expect(focus.visible).toBe(true);
    expect(focus.scrollTop).toBe(0);
  } finally {
    await fresh.context.close();
  }

  const returning = await makePage(browser, {
    viewport: { width: 320, height: 568 },
  });
  try {
    const { page } = returning;
    await showIndex(page);
    await page.locator('[data-go="folio"]').click();
    await page.locator('#folNew').click();
    const search = page.locator('#folFindItems');
    await search.fill('nothing in this atlas has these words');
    await page.locator('#folClearFind').click();
    await expect(search).toBeFocused();
    const focus = await search.evaluate((field) => {
      const box = field.getBoundingClientRect();
      const room = field.closest('#folioOverlay').getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        visible: box.top >= room.top - 1 && box.bottom <= room.bottom + 1,
        unobscured: hit === field || field.contains(hit),
      };
    });
    expect(focus.visible).toBe(true);
    expect(focus.unobscured).toBe(true);
  } finally {
    await returning.context.close();
  }
});
