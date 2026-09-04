# Flyleaf — Chrome Web Store release kit

Everything below is copy-paste ready. Fields map 1:1 to the Web Store
dashboard. Assets are in this `store/` folder; the upload package is
`dist/flyleaf-0.1.0.zip`.

---

## 0. One-time setup (≈10 min, do this once ever)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Sign in with the Google account you want to own the listing
   (`anubra266@gmail.com` is fine).
3. Pay the **one-time $5 developer registration fee** (Google's anti-spam
   fee; unlocks publishing forever, not per-extension).
4. Fill the **account tab**: a public developer name (e.g. `Abraham` or
   `anubra266`) and a contact email. Google makes you **verify the contact
   email** once — click the link they send.

That's the whole gate. Everything after is per-release.

---

## 1. Upload the package

Dashboard → **Items** → **+ New Item** → drag in:

```
dist/flyleaf-0.1.0.zip
```

Wait for it to unpack, then fill the tabs below.

---

## 2. Store listing tab

**Item name**
```
Flyleaf — Reader Mode
```

**Summary** (132 char max — this is 106)
```
A Safari-style reader mode for the web. Clean pages, arrow-key next/prev, four themes. No ads, no tracking.
```

**Description** (paste as-is)
```
Flyleaf turns a cluttered web page into a clean, quiet reading page — the way Safari's Reader does — and adds keyboard page-turning for anything you read across many pages, from long articles to serialized stories.

WHAT IT DOES

• Reader mode anywhere. Flyleaf uses Mozilla Readability — the same engine behind Firefox's reader — to pull the article out of the page, then rebuilds it as a fast, flat "paper" sheet. No ads, no pop-ups, no floating share bars, no layout shift.

• Turn pages with the arrow keys. ← and → jump to the previous and next page. Flyleaf finds the site's own prev/next controls automatically — links and JavaScript buttons alike. When a site hides them behind odd markup, point them out once: click "Pick next", click the site's real Next control, and Flyleaf remembers it.

• Four reading themes. Light, Sepia, Gray, and Midnight — pick for your room, not the site's mood.

• Zoom like Safari. One zoom control scales the text and the page together, so big text never means a broken layout. Adjust font and line height to taste.

• Auto-enable per site. Turn Flyleaf on for a site once and it opens automatically on matching pages — scope it with a simple URL pattern so it stays off on the home page.

• Keeps up with modern sites. On single-page apps that swap content without a full reload, Flyleaf re-renders the new page on its own.

• One shortcut. Press Alt+R to toggle the reader from anywhere (rebindable at chrome://extensions/shortcuts).

PRIVACY

Flyleaf collects nothing and sends nothing anywhere. There are no analytics, no accounts, and no servers — it has no network code at all. Your theme and per-site settings live only in your own browser (Chrome sync storage). The full source is public: https://github.com/anubra266/flyleaf

WHY THE BROAD SITE ACCESS

A reader mode has to be able to read the page you're on, and reading lives on countless sites. Flyleaf asks to run on all sites so it can offer reader mode on any of them — but it injects nothing into a page until you actually open the reader there, and it never transmits page content off your machine.
```

**Category**
```
Productivity
```
(Accessibility is an acceptable alternative.)

**Language**
```
English
```

---

## 3. Graphic assets tab

| Asset | File | Notes |
| --- | --- | --- |
| Store icon (128×128) | `store/store-icon-128.png` | Usually auto-pulled from the package icon; upload if asked. |
| Screenshot 1 (1280×800) | `store/screenshot-1280x800.png` | Midnight theme — lead image. |
| Screenshot 2 (1280×800) | `store/screenshot-2-themes.png` | Sepia theme — shows range. |

Minimum is **one** 1280×800 screenshot; you have two. Promo tiles are
optional — skip them.

---

## 4. Privacy tab (this is where most first submissions stall — answers below)

**Single purpose** (paste)
```
Flyleaf provides a distraction-free reader mode for web pages: it extracts the main article text, displays it in a clean themed layout, and lets the reader move between pages with the keyboard.
```

**Permission justifications**

- `storage` →
```
Stores the user's own reading preferences (theme, zoom, line height, reader on/off per site) and any per-site prev/next link the user trains. Local to the browser; nothing is sent anywhere.
```

- Host permission / "Read and change all your data on all websites"
  (this comes from the `<all_urls>` content script) →
```
Flyleaf is a general reader mode, so it must be able to run on whatever site the user is reading — which can be any site on the web. The content script only reads the current page's text to render reader mode, and only after the user activates the reader. It never transmits page content off the device.
```

**Remote code** → **No, I am not using remote code.**
(Readability.js is bundled in the package, not fetched.)

**Data usage** — check **nothing**, then certify all three:
- ☑ I do not sell or transfer user data to third parties (outside approved use cases)
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending

**Privacy policy URL** — REQUIRED. The store rejects a GitHub repo/README
link ("owner sites are not considered valid"); it must point directly to a
standalone privacy-policy page. Use:
```
https://portfolio-anuoluwapo-abrahams-projects.vercel.app/privacy-policies/flyleaf.html
```

---

## 5. Distribution tab

- **Visibility:** Public
- **Regions:** All regions
- **Pricing:** Free

---

## 6. Submit

Click **Submit for review** (top right). First-time review for a
low-permission extension is usually **a few hours to a few days**. You'll
get an email on approval or if they want a change. Once approved it's live
at a `chromewebstore.google.com/detail/...` URL.

---

## Shipping a future update

```
cd /Users/abraham/Developer/oss/flyleaf
npm run release        # bump patch version (manifest + package) and repackage
```

Then: Dashboard → the Flyleaf item → **Package** → **Upload new package**
→ **Submit for review**.

Scripts (in `package.json`):

| Command | Does |
| --- | --- |
| `npm run build` | Zip the extension to `dist/flyleaf-<version>.zip` |
| `npm run bump` | Bump patch version in `manifest.json` + `package.json` |
| `npm run bump:minor` / `bump:major` | Bump minor / major |
| `npm run release` | `bump` (patch) then `build` |

---

## Pre-submit checklist

- [x] Icons 16/48/128 present and correctly sized
- [x] `manifest.json` description ≤132 chars, version set
- [x] Package zips to ~48 KB, contains only runtime files (no dist/store/.git)
- [x] Two 1280×800 screenshots
- [x] 128×128 store icon
- [x] No remote code (Readability bundled)
- [x] No data collection / no network calls
