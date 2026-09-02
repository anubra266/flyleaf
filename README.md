# Flyleaf

Safari-style reader mode for Chrome, built for serialized fiction — clean
chapters, arrow-key navigation, per-site memory.

*The flyleaf is the quiet blank page before the story starts.*

## Features

- **Reader mode anywhere** — [Mozilla Readability](https://github.com/mozilla/readability)
  (the Firefox reader engine) extracts the chapter; Flyleaf renders it as a
  clean, fast page
- **Arrow-key chapters** — `←`/`→` jump to the previous/next chapter.
  Detection is automatic (`rel` attributes, common novel-theme selectors,
  link text); when a site defies detection, **pick the links visually**:
  click "Pick next", click the site's own next-chapter button once, and
  Flyleaf remembers it for that site
- **Safari-style settings** — theme swatches (Light / Sepia / Gray /
  Midnight), Safari's font list, text size to 42px (so you never need
  browser zoom), column width, line height
- **Two disclosure modes** —
  - **Modal**: the original page stays beneath; leaving reader restores it
    instantly
  - **Page**: the original page's DOM is removed entirely while reading
    (nothing left to lay out, paint, or composite); leaving reloads it
- **Per-site on/off memory** — flip it on for a novel site once, every
  chapter opens in reader
- **`Alt+R`** to toggle (rebindable at `chrome://extensions/shortcuts`),
  or the toolbar button, or the floating `Aa` button

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this directory
3. Open a chapter page and press `Alt+R`

## In the reader

| Key | Action |
| --- | --- |
| `←` / `→` | previous / next chapter |
| `−` / `+` | text size |
| `Esc` | leave reader |

## Engineering notes

Behaviors here were each a bug once, on real novel sites:

- **Wait for content before parsing.** SPA sites render chapters after
  `document_idle`; parsing early returns `null` or a garbage shell.
  Flyleaf polls until the page holds ≥500 chars of paragraph text.
- **Mark hidden nodes in the live page before cloning.** Readability
  parses a detached clone where computed styles don't exist, so
  stylesheet-hidden ad shells and invisible anti-copy watermark spans
  would leak into the output. They're tagged live, stripped pre-parse.
- **SPA hooks re-extract only on a real URL change.** Inertia-style
  routers call `replaceState` on every scroll tick to record scroll
  position; reacting to those re-rendered the reader mid-scroll.
- **The document scrolls, not an inner div.** Root scrolling is the
  always-threaded fast path. No `backdrop-filter` anywhere (per-frame
  re-blur over scrolling content), no `content-visibility` on paragraphs
  (per-paragraph just-in-time layout hitches).
- **Picker locators degrade gracefully**: unique id/rel/class selector →
  structural `:nth-child` path from a stable ancestor → exact link text
  (`text:Next →`), for Tailwind-style sites with no unique selectors.

## Layout

```
manifest.json         MV3 manifest
src/background.js     toolbar click + Alt+R → message to content script
src/styles.js         all injected CSS (scoped under #flyleaf-*)
src/content.js        extraction, rendering, panel, picker, keys, SPA hooks
vendor/Readability.js Mozilla Readability (Apache-2.0), unmodified
```

## Roadmap

- Preload the next chapter for instant `→`
- Export/import per-site nav training
- Firefox port (MV3 differences are minimal)

## License

MIT for Flyleaf code; `vendor/Readability.js` is Apache-2.0 (Mozilla).
