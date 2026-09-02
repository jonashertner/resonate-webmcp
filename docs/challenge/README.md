# WebMCP Challenge media

These frames come from a clean browser profile running Resonate locally. The
capture flow chooses **try an example atlas**, reviews it, and then explicitly
chooses **Use as my atlas**. It never loads an account, imported file,
geolocation, or user-authored record.

| File | Intended Devpost use | What it proves |
| --- | --- | --- |
| `01-atlas-desktop.png` | Gallery frame 1 / product overview | A living, local-first atlas with places, paths, books, and recommendation context. |
| `02-assistant-consent-desktop.png` | Gallery frame 2 | The zero-data WebMCP door: scope is legible and the person must choose **Allow access** before atlas tools exist. |
| `03-assistant-readonly-desktop.png` | Primary project image / thumbnail | The canonical Marta/Paris `search_atlas` → `show_atlas_item` flow, rendered from the same disclosure-safe copy a friend may receive and explicitly read-only. |
| `04-assistant-draft-desktop.png` | Gallery frame 3 | The canonical `prepare_list` result: exactly the two wishlist places in Paris recommended by Marta are selected, but the collection is neither saved nor shared until the person acts. |
| `04-assistant-draft-mobile.png` | Gallery frame 4 / responsive proof | The same bounded Marta's Paris draft at a 390px phone viewport. |

The desktop frames are 1500×1000 (3:2). The phone frame is captured from a
390×844 CSS viewport at 2× density (780×1688). Every PNG is verified below the
5 MB Devpost limit by the capture script.

## Reproduce

From the repository root, with dependencies installed:

```sh
node tools/capture-challenge-media.mjs
```

Pass `--story-only` to refresh only the read-only item and the two collection
draft frames without rewriting the atlas and consent images.

The script reuses `http://localhost:5178/` when Resonate is already there, or
starts and stops `tools/dev.mjs` itself. Set `CHALLENGE_BASE_URL` to use another
local origin.

The capture harness supplies the same minimal proposed
`document.modelContext.registerTool` host used by the browser test suite. It
does not mock Resonate's tools or their results: the production app registers
the tools, enforces consent, queries the bundled example atlas, and paints each
review surface.
