// books.spec.mjs — a book is a record, not an inscription.
//
// This file exists because the shelf was the one kind in the atlas a person
// could not open. A place opens onto a plate, a path opens onto a plate, a
// folio opens its composer, a tag has a room; a book was type in the index
// and type on a place's plate, with no way to press it, correct it, mark it
// read, tie it, untie it, remove it, or make one by hand. store.updateBook
// existed with no caller, which is the code's own way of saying a door was
// built and never hung.
//
// Every claim here was red before the book plate existed, which is the only
// reason to believe any of it.

import { test, expect } from '@playwright/test';

const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

// arrive with a small atlas standing: one place, one book tied to it, one
// book that answers to no place. past the film, past the first-run door.
async function open(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.addInitScript(() => {
    // an init script runs again on every navigation, including the reload a
    // persistence claim ends with, and a seed that always writes would wipe
    // the very edit it is there to check. seed once, then stand aside.
    if (localStorage.getItem('resonate.books.v1')) return;
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([{
      id: 'p1', name: 'The Reading Room', lat: 46.5, lng: 8.5,
      city: 'Basel', country: 'Switzerland', tags: ['t1'], status: 'visited',
      note: '', createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't1', name: 'Culture', hue: 155, color: '#4a7' },
    ]));
    localStorage.setItem('resonate.books.v1', JSON.stringify([
      { id: 'b1', kind: 'book', title: 'A Moveable Feast', author: 'Ernest Hemingway',
        year: '1964', placeId: 'p1', tags: ['t1'], status: 'visited', private: false,
        note: 'Paris, hungry.', url: '', createdAt: now, updatedAt: now },
      { id: 'b2', kind: 'book', title: 'Invisible Cities', author: 'Italo Calvino',
        year: '1972', placeId: '', tags: [], status: 'wishlist', private: false,
        note: 'Every one of them is Venice.', url: '', createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300,
    }));
  });
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, { timeout: 15000 });
}

async function shelfOpen(page) {
  if (!await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#fmIndex').click();
    await expect(page.locator('#indexOverlay')).toBeVisible();
  }
}

test('a book opens from its row, like everything else in the index', async ({ page }) => {
  await open(page);
  await shelfOpen(page);

  const row = page.locator('.ix-row.book', { hasText: 'Invisible Cities' });
  await expect(row).toBeVisible();
  // the title is the door, the way a place's name is
  await row.locator('.ix').click();
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('#plate .plate-name')).toHaveText('Invisible Cities');
  // and the plate holds what the row used to have to say inline
  await expect(page.locator('#pBookNote')).toHaveValue('Every one of them is Venice.');
  await expect(page.locator('#pBookAuthor')).toHaveValue('Italo Calvino');
  await expect(page.locator('#pBookYear')).toHaveValue('1972');
});

test('the plate corrects a book, and the correction survives the boot', async ({ page }) => {
  await open(page);
  await shelfOpen(page);
  await page.locator('.ix-row.book', { hasText: 'Invisible Cities' }).locator('.ix').click();

  const title = page.locator('#plate .plate-name');
  await title.fill('Le città invisibili');
  await title.press('Enter');
  // read, not want to read: the same two words every record answers to
  await page.locator('#pBookStatus [data-st="visited"]').click();

  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await shelfOpen(page);
  const row = page.locator('.ix-row.book', { hasText: 'Le città invisibili' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('want to read');
  // an edited book is fully yours: the sample flag cannot survive a correction
  const kept = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('resonate.books.v1'))
      .find(x => x.id === 'b2');
    return { status: b.status, sample: !!b.sample };
  });
  expect(kept).toEqual({ status: 'visited', sample: false });
});

test('a book is made from the command line, the way a place is', async ({ page }) => {
  await open(page);
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>book');
  await page.locator('.cmd-row', { hasText: 'book' }).first().click();

  await expect(page.locator('#askInput')).toBeVisible();
  await page.locator('#askInput').fill('The Leopard');
  await page.locator('#askGo').click();

  // one press, and the plate is standing, ready for the rest or not
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('#plate .plate-name')).toHaveText('The Leopard');
  await page.locator('#pClose').click();
  await shelfOpen(page);
  await expect(page.locator('.ix-row.book', { hasText: 'The Leopard' })).toBeVisible();
});

test('read at is a door that swings both ways, and a tie can be made and unmade', async ({ page }) => {
  await open(page);
  await shelfOpen(page);
  await page.locator('.ix-row.book', { hasText: 'A Moveable Feast' }).locator('.ix').click();

  // the tie is a door to the place
  await expect(page.locator('#pBookAt')).toHaveText('The Reading Room');
  await page.locator('#pBookAt').click();
  await expect(page.locator('#plate .plate-name')).toHaveText('The Reading Room');

  // and the place's shelf is a door back to the book
  await page.locator('#plate [data-bopen]', { hasText: 'A Moveable Feast' }).click();
  await expect(page.locator('#plate .plate-name')).toHaveText('A Moveable Feast');

  // unmade: the book answers to no place, and the plate offers to tie one
  await page.locator('#pBookUntie').click();
  await expect(page.locator('#pBookAt')).toHaveCount(0);
  await expect(page.locator('#pBookAtFind')).toBeVisible();

  // made again: typed against your own places, nothing asked of any server
  await page.locator('#pBookAtFind').fill('read');
  await page.locator('#pBookAtMatches [data-tie="p1"]').click();
  await expect(page.locator('#pBookAt')).toHaveText('The Reading Room');
  const tie = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.books.v1')).find(b => b.id === 'b1').placeId);
  expect(tie).toBe('p1');
});

test('remove asks first, and the toast holds the word that takes it back', async ({ page }) => {
  await open(page);
  await shelfOpen(page);
  await page.locator('.ix-row.book', { hasText: 'Invisible Cities' }).locator('.ix').click();

  await page.locator('#pBookRemove').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askBox')).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#askNo')).toBeFocused();
  await page.locator('#askGo').click();

  await expect(page.locator('#plate')).toBeHidden();
  await shelfOpen(page);
  await expect(page.locator('.ix-row.book', { hasText: 'Invisible Cities' })).toHaveCount(0);

  // the way back, while the toast still stands
  await page.locator('#toast button', { hasText: 'take it back' }).click();
  await expect(page.locator('.ix-row.book', { hasText: 'Invisible Cities' })).toBeVisible();
});

test('the assistant door counts the shelf it hands over', async ({ page }) => {
  // The file for an assistant has always carried the books: outward() takes
  // them and disclosureCounts counts them. The review at the door did not say
  // so, which is an under-disclosure at the one surface whose whole job is
  // saying what leaves. The claim: the door's numbers are the file's numbers.
  await open(page);
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
  }
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>you');
  await page.locator('.cmd-row', { hasText: 'settings' }).first().click();
  await page.locator('#moreForms').click();
  await page.locator('#expAgent').click();
  await expect(page.locator('#agentBody')).toContainText('2 books');
});

test('the head and the census both count the shelf', async ({ page }) => {
  await open(page);
  await shelfOpen(page);
  await expect(page.locator('#ixWays')).toContainText('2 books');

  await page.locator('#indexClose').click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>you');
  await page.locator('.cmd-row', { hasText: 'settings' }).first().click();
  await expect(page.locator('#censusLine')).toContainText('2 books');
});
