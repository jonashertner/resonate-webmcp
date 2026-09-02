// release.test.mjs — the engines the suite drives come out of the image, and
// the image is the version this repository pins.
//
// Twice in two days a release was held back by a machine nobody here owns. The
// browser job ran `playwright install --with-deps`, which asks an ubuntu mirror
// for about 114 MB of the system libraries webkit wants. On 19 August 2026 that
// mirror answered `Ign` to every suite and then went quiet: two consecutive runs
// sat in that one step for 1h48m each and the suite never started. Capped at 45
// minutes, the next release met the same mirror in a slower rather than deader
// mood, `Fetched 114 MB in 32min 13s (59.0 kB/s)`, spent 33 of its 45 minutes
// there, and had its suite killed with twelve minutes on the clock. Nothing was
// wrong with any of those three revisions.
//
// The official playwright image already carries the three engines and every
// library they need, from a registry that is not that mirror. So the workflows
// run inside it and apt is not in the path of a release at all.
//
// That trade has exactly one edge, and it is why this file exists: playwright
// will not use browsers whose version does not match the package driving them,
// and dependabot bumps that package here. A tag and a dependency that drift
// apart fail in the browsers, far from the line that caused it. So the two are
// held equal, and the step that used to reach for the mirror is held gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const FLOWS = ['.github/workflows/pages.yml', '.github/workflows/test.yml'];
const PLAYWRIGHT_DIGEST = 'sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a';
const pinned = JSON.parse(read('package.json')).devDependencies['@playwright/test'];
const image = `mcr.microsoft.com/playwright:v${pinned}-noble@${PLAYWRIGHT_DIGEST}`;

test('the pinned playwright is an exact version, not a range', () => {
  // ^1.56.1 would make the sentence below unanswerable: the tag names one
  // build and a caret names every later one.
  assert.match(pinned, /^\d+\.\d+\.\d+$/, `@playwright/test is "${pinned}"`);
});

for (const flow of FLOWS) {
  test(`${flow} drives the engines from the image it pins`, () => {
    const src = read(flow);
    const tags = [...src.matchAll(/image:\s*mcr\.microsoft\.com\/playwright:v([\d.]+)-\w+/g)]
      .map(m => m[1]);
    assert.ok(tags.length > 0, 'no playwright image is named in this workflow');
    for (const tag of tags) {
      assert.equal(tag, pinned,
        `the image says v${tag} and package.json says ${pinned}; ` +
        'playwright will not find browsers across that gap');
    }
    assert.ok(src.includes(`image: ${image}`),
      'the Playwright tag is readable, but its image bytes are not pinned');
  });

  test(`${flow} does not fetch browsers over the wire`, () => {
    const src = read(flow);
    // The comment above records what this line costs when it is present. It is
    // matched loosely on purpose: `install`, `install --with-deps` and
    // `install-deps` all end at the same mirror.
    const reaching = src.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => !line.trimStart().startsWith('#'))
      .filter(([, line]) => /playwright\s+install/.test(line));
    assert.deepEqual(reaching, [],
      'a release must not wait on an ubuntu mirror to find out whether it is green');
  });
}

// ---------- what the deploy carries, and what the smoke check asks for ----------
//
// These two lists are one claim written twice, and on 20 August 2026 they came
// apart without a word.
//
// `actions/upload-pages-artifact` went from v3 to v5 and its tar grew a third
// exclude, `--exclude=.[^/]*`, behind a new input defaulting to false. It is
// every dot-entry at every level, not the two named beside it, so the artifact
// stopped carrying `.well-known/security.txt`: sixty-three entries became
// sixty-one, the deploy went green, and the site quietly answered 404 on the one
// address this repository publishes in a document telling people where to send a
// vulnerability.
//
// Nothing was red, because nothing looked. The three deploys after the bump all
// died in `browser`, and `smoke` runs after `deploy` and was skipped every time.
// The first run that got as far as asking asked twenty times over five minutes
// and was told 404 twenty times.
//
// So the binding is stated here, where it is free, rather than waited for at the
// end of a thirty-five minute deploy. It fails in both directions: drop the
// input and the smoke list is asking for something the artifact cannot hold;
// add a dot-path to the smoke list without it and the same.
test('the smoke check derives its files from the staged artifact', () => {
  const src = read('.github/workflows/pages.yml');
  assert.match(src, /find _site -type f -print0 \| sort -z/,
    'the byte comparison is a hand-maintained subset of the staged files');
  assert.match(src, /for local in "\$\{staged\[@\]\}"/,
    'the byte-comparison loop does not walk the generated file list');
  const uploads = src.includes('actions/upload-pages-artifact');
  assert.ok(uploads, 'the deploy no longer uploads a pages artifact');
  assert.match(src, /include-hidden-files:\s*true/,
    'the generated list includes dot-paths, which the artifact strips by default');
  assert.match(src, /byte_exceptions=\(vendor\/leaflet\/leaflet\.js\)/,
    'a byte-comparison exception must be explicit');
  assert.match(src, /page_url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/,
    'the deploy does not expose the exact URL GitHub published');
  assert.match(src, /SITE_URL: \$\{\{ needs\.deploy\.outputs\.page_url \}\}/,
    'the smoke job does not follow the URL GitHub published');
  assert.match(src, /"\$site\/vendor\/leaflet\/leaflet\.js"/,
    'the explicit byte-comparison exception is not checked for reachability');
});

test('dependabot follows the pinned Playwright container', () => {
  const src = read('.github/dependabot.yml');
  assert.match(src,
    /package-ecosystem:\s*docker[\s\S]*?directory:\s*\/\.github\/playwright/,
    'the immutable image cannot receive an automated update proposal');
  assert.ok(read('.github/playwright/Dockerfile').split('\n').includes(`FROM ${image}`),
    'the Docker manifest watched by Dependabot differs from the workflow image');
});

test('the private-repository security fallback scans history with verified bytes', () => {
  const script = read('.github/scripts/security-fallback.sh');
  assert.match(script, /gitleaks_version=8\.30\.1/);
  assert.match(script,
    /gitleaks_sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(script, /sha256sum -c -/,
    'the downloaded scanner is not verified before execution');
  assert.match(script, /"\$security_tmp\/gitleaks" git --no-banner --redact/,
    'the fallback does not scan committed history with redacted output');
  assert.doesNotMatch(script, /--verbose|\s-v(?:\s|$)/,
    'the scanner must not print secret matches into a workflow log');
  for (const flow of FLOWS) {
    const src = read(flow);
    assert.match(src, /fetch-depth:\s*0/,
      `${flow} gives a history scan only a shallow checkout`);
    assert.match(src, /bash \.github\/scripts\/security-fallback\.sh/,
      `${flow} does not run the private-repository security fallback`);
  }
});
