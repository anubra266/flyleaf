# Flyleaf

A Safari-style reader mode for Chrome — distraction-free reading, arrow-key
page navigation, and per-site memory.

*The flyleaf is the quiet blank page before the story starts.*

## Features

- **Reader mode anywhere** — [Mozilla Readability](https://github.com/mozilla/readability)
  (the Firefox reader engine) pulls the article out of the page; Flyleaf
  renders it as a clean, fast page.
- **Arrow-key navigation** — `←`/`→` jump to the previous/next page.
  Detection is automatic (`rel` attributes, common prev/next selectors,
  link text) and handles button / JS controls, not just links. When a site
  defies detection, **pick the controls visually**: click "Pick next",
  click the site's own next button once, and Flyleaf remembers it.
- **Themes & type** — a global theme (Light / Sepia / Gray / Midnight),
  plus font, Safari-style zoom, and line height saved **per site** (each
  site remembers how you like to read it).
- **Per-site auto-enable** — turn Flyleaf on for a site once and it opens
  automatically on matching pages. Scope it with URL patterns (e.g.
  `/series/*/chapter-*`, comma-separated) so it stays off on the home page.
- **Follows same-page navigation** — on SPA sites that change the URL
  without a reload, Flyleaf re-parses the new page automatically.
- **All settings live in the toolbar popup** — nothing is injected into a
  page until you enter the reader.
- **`Alt+R`** to toggle (rebindable at `chrome://extensions/shortcuts`).

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this directory
3. Open a page and press `Alt+R`, or click the Flyleaf icon → **Enable Reader**

## Safari (iPhone, iPad, Mac)

`safari/Flyleaf/Flyleaf.xcodeproj` wraps the same extension files (it
references `manifest.json`, `src`, `vendor` and `icons` in place — no
copies), so there is one codebase for Chrome and Safari.

1. Open the project in Xcode, pick the **Flyleaf (iOS)** or
   **Flyleaf (macOS)** scheme, set your team under *Signing & Capabilities*,
   and run.
2. iOS: **Settings → Apps → Safari → Extensions → Flyleaf** → turn it on
   and allow it on all websites. macOS: Safari → Settings → Extensions.
3. In Safari, tap the **ᴀA** / puzzle icon → Flyleaf → **Enable Reader**.

On touch screens, swipe left / right for the next / previous chapter, and
the picker works by tapping (with a Cancel button instead of `Esc`).
iOS has no keyboard shortcuts, so toggle from the popup or use per-site
auto-enable.

## In the reader

| Key | Action |
| --- | --- |
| `←` / `→` | previous / next page |
| `−` / `+` | zoom |
| `Esc` | exit reader |
| swipe ← / → | next / previous page (touch) |

## Engineering notes

Behaviors here were each a real bug once:

- **Wait for content before parsing.** SPA sites render the article after
  load; parsing early returns `null` or a garbage shell. Flyleaf polls
  until the page holds enough text — counting `<div>`-per-line pages, not
  just `<p>`.
- **Mark hidden nodes in the live page before cloning.** Readability parses
  a detached clone where computed styles don't exist, so stylesheet-hidden
  shells and invisible anti-copy spans would leak in. They're tagged live
  and stripped pre-parse.
- **Detect same-page navigation by polling `location.href`.** A content
  script can't hook the page's `history.pushState` from its isolated world,
  so polling is the reliable signal; the re-parse waits until the extracted
  page actually changes.
- **Own the keyboard while reading.** `←`/`→`/`Esc`/`±` are captured on
  `window` at `document_start` and `stopImmediatePropagation`'d across
  keydown, keypress and keyup — so a site that binds its own arrow nav
  can't navigate on top of Flyleaf.
- **The document scrolls, not an inner div.** Root scrolling is the
  always-threaded fast path. No `backdrop-filter`, no `content-visibility`
  on paragraphs.
- **Picker locators degrade gracefully**: unique id/rel/class selector →
  structural `:nth-child` path → exact link/button text, for sites with no
  unique selectors.

## Layout

```
manifest.json         MV3 manifest
src/background.js     Alt+R command → message to content script
src/styles.js         all injected CSS (scoped under #flyleaf-*)
src/popup.html+js     the settings popup (theme, font, zoom, nav training)
src/content.js        extraction, rendering, picker, keys, SPA polling
vendor/Readability.js Mozilla Readability (Apache-2.0), unmodified
safari/Flyleaf/       Xcode wrapper app for Safari (iOS + macOS)
```

## Roadmap

- Export/import per-site settings
- Firefox port (MV3 differences are minimal)

## License

MIT for Flyleaf code; `vendor/Readability.js` is Apache-2.0 (Mozilla).
