// The app is driven in a real browser here, because the defects that hurt
// most are the ones a parser cannot see: a control a keyboard cannot reach,
// a shared place put on the wire, a word pushed off a narrow screen.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: 'http://localhost:5178',
    // `reducedMotion: 'reduce'` used to sit here, and it did nothing: a page
    // opened under it still reported matches=false, while page.emulateMedia
    // and an explicit browser.newContext both worked. So the suite believed
    // it was running stilled for weeks and was not. The helper in the spec
    // asks for stillness itself, where it can be seen to take effect.
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Two servers: the app, and the pretended club beside it.
  //
  // `url` rather than `port` on both, deliberately. A port-only entry makes
  // playwright write PLAYWRIGHT_TEST_BASE_URL from the last one, which would
  // point the whole suite at the mock. The mock's readiness probe is
  // /membership, which answers 401 to an anonymous request: a genuine "it is
  // answering" rather than a guess that the process started.
  //
  // The mock is only reachable from a page because tools/dev.mjs injects its
  // origin into the development policy. The shipped policy names it nowhere.
  webServer: [
    {
      command: 'node tools/dev.mjs',
      url: 'http://localhost:5178',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      command: 'node club/mock.mjs',
      url: 'http://localhost:5179/membership',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],
});
