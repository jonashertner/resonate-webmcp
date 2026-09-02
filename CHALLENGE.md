# Resonate: WebMCP Challenge submission

## One sentence

Resonate is a private atlas that remembers who recommended each place and lets
an assistant find and prepare what matters without becoming the author of the
user's memory.

Resonate is for travelers who plan from friends' recommendations rather than
generic rankings. Today those places are scattered across chats, screenshots,
and map pins; by the time a trip arrives, the source and context are gone.
Resonate preserves that relationship once, then lets an assistant search only
the shareable slice and prepare a collection for human approval.

## Why WebMCP

The atlas lives in the current browser. There is no account-backed atlas API
and the Resonate server cannot read a user's records. Before WebMCP, an
assistant could work with this context only through a manually exported copy or
fragile DOM automation. WebMCP gives it narrow, typed access to the live atlas
the person is already using, under that page's existing disclosure rules.

The result is not a headless API. The assistant can orient, search trusted
recommendations, open an item, and prepare a place or collection. Every proposal
appears in the ordinary interface. The person reviews it and makes the lasting
decision.

## What the experience can do

- Find places, paths, and books across names, location, notes, links, tags, and
  disclosed recommendation provenance.
- Answer questions such as “Which Paris places came from Marta?” without
  uploading the whole atlas or exposing records excluded from sharing.
- In the shipped example, that one structured query narrows a 46-record atlas
  to Marta's two Paris wishlist places before preparing the draft.
- Open a result in a purpose-built, read-only view made from the same reviewed
  disclosure returned to the assistant.
- Prepare a sourced place or a collection from exact search-result ids.
- Revoke all data tools immediately from the page or another tab.

The assistant cannot save, delete, publish, share, read the People list, or mark
a visit. A visit is first-person testimony, so `prepare_place` has no status
field and every proposed place begins as **Want to go**.

## Human and agent, together

The interaction has three explicit states:

1. **Before consent:** only `review_assistant_access` exists. It accepts no
   input and returns no atlas data. It opens the human review or, on a true
   first visit, brings the unfinished atlas setup forward and asks the agent to
   retry after the person completes it.
2. **During work:** five bounded tools replace it. Read results identify their
   scope and treat record text as untrusted. Prepare tools open visible drafts
   and return the human action still required.
3. **After revocation:** one abort signal cancels outstanding calls and removes
   all five data tools. The zero-data review door returns.

The product rule is: **the assistant finds and prepares; the person decides and
commits.**

## Technical implementation

Resonate is handwritten JavaScript with no framework or build step. The WebMCP
adapter registers top-level tools through `document.modelContext.registerTool`.
It includes:

- strict JSON schemas and app-side validation;
- native, versioned result objects with separate `visibleChange`, `saved`, and
  `shared` effects;
- a 1,450-byte result ceiling and cursor pagination bound to both filters and
  the exact disclosed result set;
- read-only and untrusted-content annotations;
- invocation cancellation, registration timeouts, atomic tool replacement,
  and back-forward-cache and cross-tab revocation guards;
- one outward-disclosure policy shared by links, files, print, and assistants;
  links, files, and assistants use the same disclosure builder, while print
  independently applies that same field-level policy. An assistant therefore
  receives only what the owner could hand a friend.

Start with [`js/agent.js`](js/agent.js), then read the exact contract in
[`ASSISTANT-ACCESS.md`](ASSISTANT-ACCESS.md). The focused unit suite is
[`test/agent.test.mjs`](test/agent.test.mjs); end-to-end consent, proposal, and
race tests live in [`test/browser/atlas.spec.mjs`](test/browser/atlas.spec.mjs)
and [`test/browser/privacy-races.spec.mjs`](test/browser/privacy-races.spec.mjs).

## Challenge-period eligibility

Resonate and an initial WebMCP prototype predate the challenge period. The
[`e5d43f1`](https://github.com/jonashertner/resonate/commit/e5d43f1680af95d30bbb20c97de3b27e4f484d4a)
prototype is dated August 23. The last baseline before the August 25, 11:00 AM
PT start is
[`c957ceb`](https://github.com/jonashertner/resonate/commit/c957ceb65ef329cd078f15e68212d869eddc6f5e),
dated August 25 at 5:12 AM PT. Work after that baseline rebuilt and materially
extended the prototype:

- [`0ed2665`](https://github.com/jonashertner/resonate/commit/0ed2665300c5d797b4b41e81bf42f97a59453615)
  added native structured results, strict schemas, bounded pagination, explicit
  effects, cancellation, timeouts, and revocation safety.
- [`c5a183b`](https://github.com/jonashertner/resonate/commit/c5a183b8ea84968962658f50a884cda57dbbb804)
  added the zero-data pre-consent tool, atomic replacement, accessible approval,
  and adversarial cross-tab coverage.
- The current release makes already-disclosed recommendation provenance a
  first-class overview, search filter, result, and read-only review surface.

This repository is intentionally a one-commit audited release snapshot. It is
not a claim that the whole application was created during the challenge. The
public, timestamped development record remains available in the original
development repository. The complete qualifying comparison runs from the last
pre-period baseline to the September 2 submission build:
[`c957ceb...d52219b`](https://github.com/jonashertner/resonate/compare/c957ceb65ef329cd078f15e68212d869eddc6f5e...d52219b54ac900d4f8a18b932d5c9596eacee378).
Judges should evaluate only the WebMCP extension documented here and in that
record.

## Judge walkthrough

1. Open [resonate.select](https://resonate.select/) in ChatGPT's in-app browser.
2. Choose **try an example atlas**, then **Use as my atlas**.
3. Send the prompt below.
4. When the zero-data review opens, inspect it, press **Allow access**, close the
   review, and tell the assistant to continue.
5. Confirm that the collection opens as a visible, unsaved draft.
6. Press **Stop access** in Settings and confirm that the five data tools vanish.

> Use Resonate's site tools. Open the assistant-access review first. After I
> approve and close it, find Paris places I still want to visit that were
> recommended by Marta. Explain why two fit together, then prepare an unsaved
> collection called Marta's Paris. Do not save or share anything.

## Demo video: 2 minutes 40 seconds

- **0:00-0:15:** “Recommendations scatter across messages and maps. Resonate
  remembers the place, who led you there, and nothing the user did not choose.”
- **0:15-0:35:** Show the example atlas and two Paris records marked **after
  Marta**. State that the data is local to this browser.
- **0:35-0:55:** Ask the assistant to begin. Show that the only available tool
  opens a zero-data review and cannot approve itself.
- **0:55-1:40:** Approve, close, and continue. Show overview, provenance-filtered
  search, the assistant's short explanation, and the visible collection draft.
- **1:40-2:05:** Point to **save collection** but do not press it. Show the
  structured result saying `saved: false` and `shared: false`.
- **2:05-2:25:** Revoke access. Show the five tools disappearing.
- **2:25-2:40:** Show the contract and tests. Close with: “WebMCP lets an agent
  use private local context without giving it ownership of the user's truth.”

Record a clean synthetic atlas, no personal data, no background music, and a
voice track. Keep the final public YouTube video under three minutes and verify
it while logged out.

## Verification

```bash
npm ci
npm run verify:web
npm run test:browser
npm audit
npm --prefix club audit
```

Before final submission, verify the live URL, public repository and license,
project thumbnail, gallery, public video with audio, project story, built-with
tags, eligibility declarations, and logged-out access to every link.
