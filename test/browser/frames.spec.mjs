// frames.spec.mjs — the measurement behind frames.mjs, kept where it can fail.
//
// A helper that exists because of a number should be guarded by that number,
// or the next person deletes it as superstition. The number is in frames.mjs:
// a second device in this suite was being served one animation frame a second
// inside the CI container while the first was served sixty-two, and Playwright
// decides an element has stopped moving by comparing two consecutive frames.
//
// This was proved red the only way it can be, which is not on this machine. On
// a developer's machine both pages run at sixty-two whether they are fronted or
// not, because there is a real compositor underneath. In the container, without
// the `bringToFront` this file is guarding, the same measurement reads one
// frame a second, five runs out of five. With it, sixty-two, twice out of
// twice. So a developer running this sees it pass for the wrong reason, and CI
// sees it pass for the right one; what neither can do any more is go quiet.
import { test, expect } from '@playwright/test';
import { front } from './frames.mjs';

// Sixty-two a second is what a healthy page reports. Twenty is the floor: well
// under a throttled page's rate and well over the one-a-second that hung eight
// tests, so it names the fault rather than the frame rate of the day.
const FLOOR = 20;

const framesInOneSecond = (page) => page.evaluate(() => new Promise((done) => {
  const t0 = performance.now();
  let n = 0;
  const step = () => {
    n++;
    if (performance.now() - t0 >= 1000) return done(n);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => done(n), 1600);
}));

test('a second device is painted once it has been brought forward', async ({ page, browser }) => {
  const second = await browser.newContext();
  const other = await second.newPage();
  // Both devices are let all the way in, one at a time and while foregrounded,
  // before either is measured. The app's opening is itself worth one to three
  // frames a second under software rendering, which is a real thing about the
  // app and the wrong thing to measure here: a reading taken during it says
  // nothing about whether webkit is painting the page, only that the page is
  // busy. A navigation can hand the compositor back to the page opened last,
  // so foreground this page after the navigation and before waiting on its
  // animation. The first draft of this test measured that opening and failed
  // in the container while the suite it was guarding passed, which is the
  // useful way round for a mistake.
  for (const p of [page, other]) {
    await p.goto('/');
    await front(p);
    await expect(p.locator('#intro')).toBeHidden({ timeout: 15000 });
    await expect(p.locator('body'))
      .toHaveAttribute('data-entry', /board|field|letter|threshold/, { timeout: 15000 });
  }

  // ada's phone is the one being looked at
  await front(page);
  await expect.poll(() => framesInOneSecond(page), { timeout: 15000 })
    .toBeGreaterThan(FLOOR);

  // and now bruno's, which is the move the suite makes twenty-four times
  await front(other);
  await expect.poll(() => framesInOneSecond(other), { timeout: 15000 })
    .toBeGreaterThan(FLOOR);

  // handing the light over did not take it from the first device: both are
  // being watched, in the test's fiction and in fact
  await front(page);
  await expect.poll(() => framesInOneSecond(page), { timeout: 15000 })
    .toBeGreaterThan(FLOOR);

  await second.close();
});
