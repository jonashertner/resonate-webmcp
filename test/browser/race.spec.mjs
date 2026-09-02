// race.spec.mjs — the words an engine uses when a read loses to a navigation
// are the words the guard in navsafe.mjs knows.
//
// That guard turns one message into "not yet". If a Playwright release rewords
// it, the guard silently stops guarding and the flake it was written for comes
// back in club.spec.mjs looking like a fresh defect in the club. So the message
// is measured here, in all three engines, rather than trusted.
//
// It is also written so that it cannot go vacuous: if navigating under a read
// ever stops provoking a refusal at all, this fails rather than passing on a
// race that no longer happens.
import { test, expect } from '@playwright/test';
import { NAVIGATING } from './navsafe.mjs';

test('a read that loses to a navigation says so in words the guard knows', async ({ page }) => {
  await page.goto('/');
  let message = '';
  for (let i = 0; i < 80 && !message; i++) {
    const nav = page.goto(`/?n=${i}`).catch(() => {});
    for (let j = 0; j < 10 && !message; j++) {
      try { await page.evaluate(() => localStorage.length); }
      catch (e) { message = String(e.message).split('\n')[0]; }
    }
    await nav;
  }
  expect(message, 'no read was refused in 80 navigations, so this measures nothing').toBeTruthy();
  expect(message).toMatch(NAVIGATING);
});
