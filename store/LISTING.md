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
Flyleaf — Reader Mode for Novels
```

**Summary** (132 char max — this is 111)
```
Safari-style reader mode for web novels. Clean chapters, arrow-key next/prev, four themes, no ads, no tracking.
```

**Description** (paste as-is)
```
Flyleaf turns any web-novel or serialized-fiction site into a clean, quiet reading page — the way Safari's Reader does, but built for the way you actually read novels: one chapter after another, for hours.

WHAT IT DOES

• Reader mode anywhere. Flyleaf uses Mozilla Readability — the same engine behind Firefox's reader — to pull just the chapter text out of the page, then rebuilds it as a fast, flat "paper" sheet. No ads, no pop-ups, no floating share bars, no layout shift.

• Turn pages with the arrow keys. ← and → jump to the previous and next chapter. Flyleaf finds the site's own prev/next links automatically. When a site hides them behind odd markup, you can point them out once — click "Pick next", click the site's real Next button, and Flyleaf remembers it for that site forever.

• Four reading themes. Light, Sepia, Gray, and Midnight — pick per your room, not the site's mood.

• Zoom like Safari. One zoom control scales the text and the page together, so big text never means a broken layout. Adjust font, line height, and column feel to taste.

• Two ways to read. Modal mode keeps the original page underneath and restores it instantly when you leave. Page mode removes the original page entirely while you read, for the lightest possible render on heavy sites.

• Remembers per site. Flip Flyleaf on for a novel site once and every chapter opens straight into the reader.

• One shortcut. Press Alt+R to toggle the reader from anywhere (rebindable at chrome://extensions/shortcuts).

PRIVACY

Flyleaf collects nothing and sends nothing anywhere. There are no analytics, no accounts, and no servers — it has no network code at all. Your theme and per-site settings live only in your own browser (Chrome sync storage). The full source is public: https://github.com/anubra266/flyleaf

WHY THE BROAD SITE ACCESS

A universal reader has to be able to read the page you're on, and novels live on thousands of small, ever-changing sites. Flyleaf asks to run on all sites so it can offer reader mode on any of them — but it injects nothing into a page until you actually open the reader there, and it never transmits page content off your machine.
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
Flyleaf provides a distraction-free reader mode for web-novel and serialized-fiction pages: it extracts the chapter text, displays it in a clean themed layout, and lets the reader move between chapters with the keyboard.
```

**Permission justifications**

- `storage` →
```
Stores the user's own reading preferences (theme, zoom, line height, reader on/off per site) and any per-site prev/next link the user trains. Local to the browser; nothing is sent anywhere.
```

- Host permission / "Read and change all your data on all websites"
  (this comes from the `<all_urls>` content script) →
```
Flyleaf is a universal reader, so it must be able to run on whatever novel site the user is reading — and those sites number in the thousands. The content script only reads the current page's text to render reader mode, and only after the user activates the reader. It never transmits page content off the device.
```

**Remote code** → **No, I am not using remote code.**
(Readability.js is bundled in the package, not fetched.)

**Data usage** — check **nothing**, then certify all three:
- ☑ I do not sell or transfer user data to third parties (outside approved use cases)
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending

**Privacy policy URL** — not required while you collect no data. If the form
insists, this repo's README + the "PRIVACY" section above suffice; you can
paste a one-line policy or point to:
```
https://github.com/anubra266/flyleaf#privacy
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
