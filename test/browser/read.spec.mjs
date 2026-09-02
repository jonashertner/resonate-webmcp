// read.spec.mjs — the documents, now that none of them is unfinished.
//
// This file used to assert the opposite of everything below it. TERMS.md and
// PRIVACY.md were reachable before they were true: they named a seller that was
// still PUT-THE-LEGAL-NAME-HERE, and js/read.js asked for a word before setting
// either. Four of the five tests here were written to go red at the switch, and
// they did, in the commit that filled the last placeholder. This is that commit.
//
// What is asserted now is the state that replaced it: both documents are set for
// anybody who asks, neither carries a placeholder in the bytes the host serves,
// and the terms say out loud that nothing is being charged yet.
//
// THE LIMIT, STATED RATHER THAN LEFT TO BE DISCOVERED. The curtain still exists
// in js/read.js and js/marks.js keeps the list it reads, because the next
// document written ahead of its facts will want it. With that list empty there
// is no document for the curtain to stand in front of, so this suite cannot
// drive it and does not pretend to. What it holds instead is the fact that makes
// the curtain unnecessary, and test/docs.test.mjs holds the binding in both
// directions: a document with a placeholder left in it must be on that list, and
// a document with none must not be.
import { test, expect } from '@playwright/test';

const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

// Every test gets its own context and so its own empty storage, which is the
// device this matters on: a reader who has never been given a word, arriving at
// a document that no longer asks for one.
async function fresh(page) {
  for (const pattern of OFF) await page.route(pattern, (r) => r.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

const gate = (page) => page.locator('#readGate');
const heading = (page) => page.locator('#readBody h1');

test('document loading is announced without making the whole document a live region', async ({ page }) => {
  await fresh(page);
  let releaseReader;
  let sawReader;
  const readerHeld = new Promise((resolve) => { releaseReader = resolve; });
  const readerRequested = new Promise((resolve) => { sawReader = resolve; });
  await page.route('**/js/read.js*', async (route) => {
    const response = await route.fetch();
    sawReader();
    await readerHeld;
    await route.fulfill({ response });
  });
  let release;
  let sawRequest;
  const held = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { sawRequest = resolve; });
  await page.route('**/TERMS.md', async (route) => {
    sawRequest();
    await held;
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown',
      body: '# The terms\n\nA deliberately held document.',
    });
  });

  const navigation = page.goto('/read.html?d=terms', { waitUntil: 'domcontentloaded' });
  await readerRequested;

  const body = page.locator('#readBody');
  const status = page.locator('#readStatus');
  await expect(status, 'the live region entered the tree pre-filled').toBeEmpty();
  releaseReader();
  await navigation;
  await requested;

  await expect(body).toHaveAttribute('aria-busy', 'true');
  await expect(body).not.toHaveAttribute('aria-live');
  await expect(status).toHaveClass(/\bsr-only\b/);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status).toHaveText('Loading document.');

  release();
  await expect(body).not.toHaveAttribute('aria-busy');
  await expect(status).toHaveText('Document ready.');
  await expect(heading(page)).toHaveText('The terms');
});

test('the terms are set for anyone who asks, and ask for nothing back', async ({ page }) => {
  await fresh(page);
  await page.goto('/read.html?d=terms');
  await expect(gate(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText('The terms');
  await expect(page.locator('#readBody')).toContainText('CHF 48 a year');
  // and the seller is a name rather than the shape of one
  await expect(page.locator('#readBody')).toContainText('Resonate Select');
  await expect(page.locator('#readBody')).not.toContainText('PUT-THE-');
});

test('the privacy notice is set for anyone who asks, and ask for nothing back', async ({ page }) => {
  await fresh(page);
  await page.goto('/read.html?d=privacy');
  await expect(gate(page)).toHaveCount(0);
  await expect(page.locator('#readBody')).toContainText('what the club holds');
  await expect(page.locator('#readBody')).toContainText('Resonate Select');
  await expect(page.locator('#readBody')).not.toContainText('PUT-THE-');
});

test('support is readable and gives a private contact without exposing a secret', async ({ page }) => {
  await fresh(page);
  await page.goto('/read.html?d=support');
  await expect(gate(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText('Support and testing');
  await expect(page.locator('#readBody')).toContainText('release shown at the foot of you');
  await expect(page.locator('#readBody a[href="mailto:resonateselect@proton.me"]')).toBeVisible();
  await expect(page.locator('#readBody')).toContainText('Do not send your private backup');
});

test('a document that was never behind the word is unchanged', async ({ page }) => {
  await fresh(page);
  await page.goto('/read.html?d=threats');
  await expect(gate(page)).toHaveCount(0);
  await expect(heading(page)).toContainText('threat');
});

test('nothing was written to the device to earn any of that', async ({ page }) => {
  // The word, while there was one, was remembered as the fact that it had been
  // answered and never as the word. With no word to answer, nothing at all
  // should be written: a reader of a public document leaves no trace of having
  // read it, which is the same promise the atlas makes about everything else.
  await fresh(page);
  await page.goto('/read.html?d=terms');
  await expect(heading(page)).toHaveText('The terms');
  expect(await page.evaluate(() => localStorage.getItem('resonate.reading.v1')))
    .toBe(null);
});

test('the served bytes carry no placeholder, and say what is not being charged',
  async ({ request }) => {
    // Read from the host rather than from the page. The reader sets the same
    // markdown the host serves, so a document corrected in the repository and
    // not in the deploy would pass every test above and fail this one.
    for (const path of ['/TERMS.md', '/PRIVACY.md']) {
      const raw = await request.get(path);
      expect(raw.status(), `${path} is not served`).toBe(200);
      // hard-wrapped for the person editing it, so a sentence is not a line and
      // the emphasis around one may sit either side of a newline
      const text = (await raw.text()).replace(/\*\*/g, '').replace(/\s+/g, ' ');
      expect(text, `${path} still names a seller that does not exist`).not.toContain('PUT-THE-');
      expect(text, `${path} does not say that nothing is being charged`)
        .toContain('no money changes hands');
      expect(text).toContain('Resonate Select');
    }
  });
