# Web release

The website is the primary Resonate application. It is a static, installable
web app served from `https://resonate.select`. The native projects are separate
release surfaces and are not part of this payload.

## local release gate

```bash
npm ci
npm run verify:web
npm run test:browser
npm audit
```

`npm run web:stage` writes `_site` from an explicit allowlist. Tests, tools,
package machinery, club implementation, native projects, and local secrets do
not enter the directory. `release.json` identifies the exact Git commit in the
artifact.

## publish

Merge a commit to `main` only after the required `test` and `browser` checks
pass. GitHub does not currently require an approving review, so a maintainer
who requires one must record it before merging rather than treating it as an
enforced gate. The Pages workflow repeats unit and browser tests, stages the
same allowlist, deploys it, and then compares every staged regular file byte for
byte with the checkout except the one large asset it checks for reachability.
It also proves that repository machinery is not public and that the club
agrees with the site's sandbox or live claim.

Do not upload `_site` by hand. A manual Pages workflow run is for redeploying a
commit already on `main`, not for publishing a working tree outside those
checks.

## tester handoff

Send the canonical HTTPS address and the instructions at
`https://resonate.select/read.html?d=support`. Ask testers to include the
release shown under **Settings** in every report.

The atlas is tied to both the browser and the site origin. Data created on a
beta subdomain does not appear on `resonate.select`. Before moving a tester
between origins, have them export a private backup and import it on the new
origin.

Start with one current iPhone, one current Android phone, and one computer.
Test first visit, home-screen installation, close and reopen, offline open,
location permission, incoming and outgoing links, export, erase, and restore.

## rollback

Revert the release commit on `main` and let the same workflow deploy the
revert. Do not rewrite `main` or delete the Pages environment. If a data format
changed, verify first that the prior release can still read the records written
by the release being rolled back.
