/* Flyleaf — content script.
   A Safari-style reader mode for the web.

   Hard-won behaviors baked in (each one was a real bug once):
   - Wait for content before parsing: SPAs render chapters after
     document_idle; parsing early returns null or a garbage shell.
   - Mark hidden nodes in the LIVE page before cloning: Readability
     can't see stylesheet-driven visibility, so ad shells and
     invisible anti-copy watermark spans leak into the clone.
   - SPA history hooks re-extract ONLY on a real URL change:
     Inertia-style routers call replaceState on every scroll tick.
   - The reader is an in-flow block and the DOCUMENT scrolls (root
     scroller = fastest path). No inner scroller, no content-visibility
     on paragraphs, no backdrop-filter anywhere.
   - The reader overlays the page; leaving it restores the site instantly
     (the original DOM is hidden, never removed). */

(function () {
  'use strict';
  if (window !== window.top || window.__flyleaf) {
    return;
  }
  window.__flyleaf = true;

  const HOST = location.hostname.replace(/^www\./, '');
  const MIN_TEXT = 500;

  /* ---------------- themes / fonts (Safari Reader's set) ---------------- */

  /* Safari Reader's paper feel: a darker BACKDROP behind a raised,
     rounded SHEET (bg) that carries the text. edge = the sheet's ring. */
  const THEMES = {
    light:    { backdrop: '#e8e8ea', bg: '#ffffff', edge: 'transparent', text: '#2c2c2c', strong: '#111111', muted: '#666666', dim: '#999999', border: '#e2e2e2', borderHi: '#cfcfcf', chip: '#f1f1f1', progress: '#888888' },
    sepia:    { backdrop: '#e2d7bd', bg: '#f4ecd8', edge: 'transparent', text: '#48402f', strong: '#2c2518', muted: '#786c53', dim: '#9a8e73', border: '#ded2b6', borderHi: '#c8bb9b', chip: '#ebe1c9', progress: '#9a8e73' },
    gray:     { backdrop: '#303033', bg: '#46464a', edge: 'transparent', text: '#e3e3e5', strong: '#ffffff', muted: '#adadb2', dim: '#8c8c92', border: '#55555b', borderHi: '#6a6a70', chip: '#525258', progress: '#adadb2' },
    midnight: { backdrop: '#000000', bg: '#101012', edge: 'transparent', text: '#cececf', strong: '#f2f2f3', muted: '#8f8f95', dim: '#6f6f76', border: '#1e1e20', borderHi: '#2a2a2c', chip: '#1a1a1c', progress: '#cfcfd0' },
  };

  const FONTS = {
    system: { label: 'System (San Francisco)', stack: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif' },
    charter: { label: 'Charter', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
    georgia: { label: 'Georgia', stack: 'Georgia, serif' },
    iowan: { label: 'Iowan Old Style', stack: '"Iowan Old Style", Georgia, serif' },
    newyork: { label: 'New York', stack: '"New York", "Iowan Old Style", Georgia, serif' },
    palatino: { label: 'Palatino', stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
    seravek: { label: 'Seravek', stack: 'Seravek, "Gill Sans", Calibri, sans-serif' },
    athelas: { label: 'Athelas', stack: 'Athelas, Georgia, serif' },
    times: { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  };

  /* Safari-style zoom: one control scales the text inside a fixed
     reading column (fewer words per line as it grows), no separate
     size or margin knobs. */
  const ZOOM_STEPS = [50, 75, 85, 100, 115, 125, 150, 175, 200, 250, 300];
  const DEFAULT_PREFS = {
    theme: 'midnight',
    font: 'system',
    zoom: 100,
    lh: 1.8,
  };

  /* ---------------- storage ---------------- */

  const store = {
    async get(key, fallback) {
      try {
        const out = await chrome.storage.sync.get(key);
        return out[key] !== undefined ? out[key] : fallback;
      } catch {
        return fallback;
      }
    },
    async set(key, value) {
      try {
        await chrome.storage.sync.set({ [key]: value });
      } catch {
        /* storage can be unavailable in rare contexts; reader still works */
      }
    },
  };

  let prefs = { ...DEFAULT_PREFS };
  let sites = {}; /* { host: { enabled, prevSel, nextSel } } */

  const siteCfg = () => sites[HOST] || {};
  async function saveSite(patch) {
    sites[HOST] = { ...siteCfg(), ...patch };
    await store.set('sites', sites);
  }

  /* font / zoom / line-height are saved PER SITE (in sites[HOST]); theme is
     global. The effective value for a site is its override, or the global
     default when it has none. */
  const SITE_PREF_KEYS = ['font', 'zoom', 'lh'];
  const eff = (key) => {
    const v = siteCfg()[key];
    return v !== undefined ? v : prefs[key];
  };

  /* ---------------- reading-page patterns ----------------
     Auto-open is gated on a glob over the URL path, not on "does this
     look like an article". The path is known at document_start, so the
     curtain only drops on matching pages — the site's home / index page
     loads normally, with no blank themed flash. Empty pattern = whole
     site (back-compat with the old per-host on/off). */
  function globToRe(glob) {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + esc + '$', 'i');
  }
  const normPath = (p) => p.replace(/\/+$/, '') || '/';
  const splitPatterns = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
  /* pattern is a comma-separated list; the page auto-enables if it matches
     ANY entry. Entries missing a leading "/" get one, so "series/*" works. */
  function urlMatches(pattern) {
    if (!pattern) return true;
    const path = normPath(location.pathname);
    return splitPatterns(pattern).some((raw) => {
      let pat = normPath(raw);
      if (pat[0] !== '/' && pat[0] !== '*') pat = '/' + pat;
      try {
        return globToRe(pat).test(path);
      } catch {
        return true;
      }
    });
  }
  /* Seed a pattern from the current URL that generalises across the whole
     site, not just the item you're on: wildcard the number and everything
     after it in a segment, and wildcard deeper title-slug segments, while
     keeping the leading section words. e.g.
       /series/some-title/chapter-1-enter-the-palace
         -> /series/[*]/chapter-[*]
       /read/12345/67  ->  /read/[*]/[*] */
  function seedPattern() {
    const segs = normPath(location.pathname).split('/');
    const out = segs.map((seg, i) => {
      if (!seg) return seg;                                  /* leading '' */
      if (/\d/.test(seg)) return seg.replace(/\d.*$/, '*');  /* chapter-1-foo -> chapter-*, 12345 -> * */
      if (i > 1 && seg.includes('-')) return '*';            /* deeper title slug -> * */
      return seg;                                            /* section keyword -> keep */
    });
    return out.join('/').replace(/\*{2,}/g, '*') || '/*';
  }

  /* ---------------- tiny dom helpers ---------------- */

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else node.setAttribute(k, v);
    }
    children.forEach((c) => node.appendChild(c));
    return node;
  }

  let toastEl = null;
  let toastTimer = null;
  function toast(msg, sticky) {
    if (!toastEl) {
      toastEl = el('div', { id: 'flyleaf-toast' });
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('fl-show');
    clearTimeout(toastTimer);
    if (!sticky) {
      toastTimer = setTimeout(() => toastEl.classList.remove('fl-show'), 2200);
    }
  }

  /* ---------------- extraction ---------------- */

  function pageHasContent() {
    /* "has the chapter rendered yet?" — Readability does the real
       extraction later; this just waits for enough text to exist. */
    let len = 0;
    for (const n of document.querySelectorAll('p, li')) len += n.textContent.length;
    if (len >= MIN_TEXT) return true;
    /* some sites render each line as its own <div>, not a <p> — count
       leaf text blocks too */
    for (const n of document.querySelectorAll('div')) {
      if (n.children.length === 0) {
        len += n.textContent.length;
        if (len >= MIN_TEXT) return true;
      }
    }
    return len >= MIN_TEXT;
  }

  function markHidden() {
    const marked = [];
    if (!document.body) return marked;
    for (const node of document.body.getElementsByTagName('*')) {
      const cs = getComputedStyle(node);
      let hidden =
        cs.display === 'none' || cs.visibility === 'hidden' ||
        parseFloat(cs.opacity) === 0 || parseFloat(cs.fontSize) === 0;
      if (!hidden) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0 && !/^(BR|HR)$/.test(node.tagName)) {
          hidden = true;
        } else if (
          (cs.position === 'absolute' || cs.position === 'fixed') &&
          (r.right < 0 || r.bottom < 0 || parseInt(cs.textIndent, 10) < -999)
        ) {
          hidden = true;
        }
      }
      if (hidden) {
        node.setAttribute('data-fl-hidden', '1');
        marked.push(node);
      }
    }
    return marked;
  }

  function extract() {
    if (typeof Readability !== 'function') return null;

    /* markHidden() reads real layout (getBoundingClientRect). If our
       anti-flash curtain has already forced body{display:none}, every
       element reports a 0x0 rect and would be flagged hidden — which
       stripped the WHOLE page and made Readability return null (reader
       failed to open on reload / next chapter). So reveal the page for
       the synchronous duration of marking, then re-hide before we yield
       back to the event loop — no paint happens in between, no flash. */
    const hadCurtain = !!curtain;
    if (hadCurtain) curtain.remove();
    const marked = markHidden();
    if (hadCurtain) document.documentElement.appendChild(curtain);

    const clone = document.cloneNode(true);
    marked.forEach((n) => n.removeAttribute('data-fl-hidden'));

    clone
      .querySelectorAll('[data-fl-hidden], [id^="flyleaf-"]')
      .forEach((n) => n.remove());

    let article = null;
    try {
      article = new Readability(clone).parse();
    } catch (e) {
      console.warn('[flyleaf] Readability threw:', e);
      return null;
    }
    if (!article || article.length < MIN_TEXT) return null;

    const box = document.createElement('div');
    box.innerHTML = article.content;
    box
      .querySelectorAll('script, style, iframe, ins, form, button, input, noscript')
      .forEach((n) => n.remove());
    const KEEP = { href: 1, src: 1, srcset: 1, alt: 1, loading: 1 };
    for (const node of box.getElementsByTagName('*')) {
      for (const attr of [...node.attributes]) {
        if (!KEEP[attr.name.toLowerCase()]) node.removeAttribute(attr.name);
      }
      if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
    }
    return { title: article.title, node: box };
  }

  /* ---------------- prev / next ----------------
     A nav target is { url } for a real link, or { clickSel } for a
     button / JS control (many SPA sites render Prev/Next as <button> with
     no href). Following a click target means clicking the site's own
     control and letting its router navigate; the URL poll then re-parses
     the new chapter. */

  const norm = (u) => (u ? u.replace(/[#?].*$/, '').replace(/\/$/, '') : null);
  const notFlyleaf = (n) => !(n && n.closest && n.closest('[id^="flyleaf-"]'));
  /* a disabled control (e.g. "Next" on the last chapter) is not a target —
     clicking it does nothing, so it must not count as available nav */
  const isDisabled = (el) =>
    el.disabled === true || el.getAttribute('aria-disabled') === 'true';

  /* a live element -> nav target (or null) */
  function elementTarget(node) {
    if (!node || !notFlyleaf(node)) return null;
    if (node.tagName === 'A' && /^https?:/i.test(node.href || '')) {
      return norm(node.href) === norm(location.href) ? null : { url: node.href };
    }
    if (node.matches && node.matches('button, [role="button"], [onclick]')) {
      if (isDisabled(node)) return null;
      const sel = selectorFor(node);
      return sel ? { clickSel: sel } : null;
    }
    return null;
  }

  function linkByText(want) {
    for (const a of document.querySelectorAll('a[href]')) {
      if (!notFlyleaf(a)) continue;
      if ((a.textContent || '').replace(/\s+/g, ' ').trim() === want) {
        const t = elementTarget(a);
        if (t) return t;
      }
    }
    return null;
  }
  function clickByText(want) {
    for (const b of document.querySelectorAll('button, [role="button"], a')) {
      if (!notFlyleaf(b) || isDisabled(b)) continue;
      if ((b.textContent || '').replace(/\s+/g, ' ').trim() === want) {
        const sel = selectorFor(b);
        if (sel) return { clickSel: sel };
      }
    }
    return null;
  }

  const PREV_RE = /^(<|«|‹|←)?\s*prev(ious)?(\s*(chapter|post|page))?\s*$/i;
  const NEXT_RE = /^\s*next(\s*(chapter|post|page))?\s*(>|»|›|→)?\s*$/i;

  function findNav() {
    const cfg = siteCfg();

    /* resolve a stored locator string into a target */
    const fromSaved = (sel) => {
      if (!sel) return null;
      if (sel.startsWith('click-text:')) return clickByText(sel.slice(11));
      if (sel.startsWith('click:')) {
        try { const e = document.querySelector(sel.slice(6)); return e && !isDisabled(e) ? { clickSel: sel.slice(6) } : null; }
        catch { return null; }
      }
      if (sel.startsWith('text:')) return linkByText(sel.slice(5));
      try { return elementTarget(document.querySelector(sel)); } catch { return null; }
    };
    const bySelectors = (sels) => {
      for (const s of sels) {
        try { const t = elementTarget(document.querySelector(s)); if (t) return t; } catch (e) {}
      }
      return null;
    };
    const linkByRe = (re) => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (!notFlyleaf(a)) continue;
        const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 40 && re.test(t)) { const x = elementTarget(a); if (x) return x; }
      }
      return null;
    };
    /* buttons/JS controls: match exact-ish chapter nav text only, to
       avoid clicking a random "Next" (carousel, form step, pagination) */
    const clickByRe = (re) => {
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!notFlyleaf(b) || isDisabled(b)) continue;
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 24 && re.test(t)) { const sel = selectorFor(b); if (sel) return { clickSel: sel }; }
      }
      return null;
    };

    return {
      /* user-trained locator first, then links, then JS controls */
      prev:
        fromSaved(cfg.prevSel) ||
        bySelectors(['a[rel~="prev"]', '.nav-previous a', 'a.nav-previous', 'a.prev_page', 'a.chnav.prev']) ||
        linkByRe(PREV_RE) || linkByRe(/prev(ious)?\s*chapter/i) ||
        clickByRe(PREV_RE),
      next:
        fromSaved(cfg.nextSel) ||
        bySelectors(['a[rel~="next"]', '.nav-next a', 'a.nav-next', 'a.next_page', 'a.chnav.next']) ||
        linkByRe(NEXT_RE) || linkByRe(/next\s*chapter/i) ||
        clickByRe(NEXT_RE),
    };
  }

  /* follow a nav target: navigate a link, or click a JS control (the
     control lives in the still-present original DOM — hidden in modal
     mode, but a programmatic click still fires the site's router). */
  function navGo(target, label) {
    if (!target) return false;
    if (target.url) {
      beginNav();
      toast('Loading ' + label + '…', true);
      location.href = target.url;
      return true;
    }
    if (target.clickSel) {
      let elx = null;
      try { elx = document.querySelector(target.clickSel); } catch (e) {}
      if (elx && !isDisabled(elx)) { beginNav(); toast('Loading ' + label + '…', true); elx.click(); return true; }
    }
    return false;
  }
  function goPrev() { if (navigating) return; if (!navGo(nav.prev, 'previous chapter')) toast('No previous chapter'); }
  function goNext() { if (navigating) return; if (!navGo(nav.next, 'next chapter')) toast('No next chapter'); }

  /* ---------------- reader ---------------- */

  let reader = null;
  let progress = null;
  let nav = { prev: null, next: null };
  let savedScroll = 0;
  /* text signature of the rendered chapter; a re-parse after a same-page
     nav waits until this changes, so it doesn't re-render the old one */
  let lastSig = null;
  /* a chapter change is in flight (nav fired, new chapter not yet shown);
     blocks another nav and keeps the reader owning the keys until it
     settles. cleared when the new chapter renders, or by a safety timeout */
  let navigating = false;
  let navTimer = null;
  function beginNav() {
    navigating = true;
    clearTimeout(navTimer);
    navTimer = setTimeout(() => { navigating = false; }, 4000);
  }
  function endNav() {
    navigating = false;
    clearTimeout(navTimer);
  }

  /* The anti-flash curtain: on sites where reader is enabled, the page
     is hidden and painted in the theme backdrop BEFORE first paint
     (script runs at document_start), then the reader replaces it with
     no visible flash of the original site. Fails open after 15s. */
  let curtain = null;
  let curtainTimer = null;
  function curtainOn() {
    if (curtain) return;
    const t = THEMES[prefs.theme] || THEMES.midnight;
    curtain = document.createElement('style');
    curtain.id = 'flyleaf-curtain';
    curtain.textContent =
      'html{background:' + t.backdrop + ' !important}' +
      'body{display:none !important}';
    document.documentElement.appendChild(curtain);
    curtainTimer = setTimeout(curtainOff, 15000);
  }
  function curtainOff() {
    clearTimeout(curtainTimer);
    if (curtain) {
      curtain.remove();
      curtain = null;
    }
  }

  function applyPrefs() {
    const t = THEMES[prefs.theme] || THEMES.midnight;
    const st = document.documentElement.style;
    st.setProperty('--fl-bg', t.bg);
    st.setProperty('--fl-backdrop', t.backdrop);
    st.setProperty('--fl-edge', t.edge);
    st.setProperty('--fl-text', t.text);
    st.setProperty('--fl-strong', t.strong);
    st.setProperty('--fl-muted', t.muted);
    st.setProperty('--fl-dim', t.dim);
    st.setProperty('--fl-border', t.border);
    st.setProperty('--fl-border-hi', t.borderHi);
    st.setProperty('--fl-chip', t.chip);
    st.setProperty('--fl-progress', t.progress);
    st.setProperty('--fl-font', (FONTS[eff('font')] || FONTS.system).stack);
    st.setProperty('--fl-zoom', (eff('zoom') / 100).toFixed(3));
    st.setProperty('--fl-lh', String(eff('lh')));
  }

  /* a nav pill: a real <a> for links (middle-click / open-in-tab work),
     or a click-through control for JS nav; a disabled <span> when absent */
  function navPill(target, html, go) {
    if (!target) return el('span', { class: 'fl-pill', html });
    const n = el('a', { class: 'fl-pill', html });
    if (target.url) {
      n.setAttribute('href', target.url);
    } else {
      n.setAttribute('href', '#');
      n.setAttribute('role', 'button');
      n.addEventListener('click', (e) => { e.preventDefault(); go(); });
    }
    return n;
  }
  function navBar() {
    return el('div', { class: 'fl-nav' }, [
      navPill(nav.prev, '&larr;&nbsp; Previous', goPrev),
      navPill(nav.next, 'Next &nbsp;&rarr;', goNext),
    ]);
  }

  /* Pull the chapter number out of a heading so it can live in the header
     grid and the title reads clean, wherever the "Chapter N" sits:
       "Chapter 178"                       -> chapter 178
       "Chapter 178 - Real Title"          -> 178 + "Real Title"
       "Real Title - Chapter 178 - Site"   -> 178 + "Real Title"   */
  function splitChapter(full) {
    const s = (full || '').trim();
    const WORD = '(?:chapter|chap|ch|episode|ep|part|volume|vol)';
    const CH = '(?:chapter|chap|ch|episode|ep)'; /* only true chapter words when it follows the title */
    const NUM = '([0-9]+(?:\\.[0-9]+)?)';
    /* "Chapter 178" alone */
    const only = s.match(new RegExp('^' + WORD + '\\.?\\s*' + NUM + '$', 'i'));
    if (only) return { chapter: only[1], title: '' };
    /* "Chapter 178 - Title" / "178: Title" (chapter leads) */
    const lead = s.match(new RegExp('^(?:' + WORD + '\\.?\\s*)?' + NUM + '\\s*[-:.)\\u2013\\u2014]+\\s*(.+)$', 'i'));
    if (lead && lead[2]) return { chapter: lead[1], title: lead[2].trim() };
    /* "Title ... Chapter 178 ..." (chapter anywhere after the title;
       anything trailing it — a subtitle or site name — is dropped) */
    const mid = s.match(new RegExp('^(.+?)(?:\\s+|\\s*[-:.\\u2013\\u2014]\\s*)' + CH + '\\.?\\s*' + NUM, 'i'));
    if (mid && mid[1]) return { chapter: mid[2], title: mid[1].trim() };
    return { chapter: null, title: s };
  }

  /* header 2x2 grid:
       domain (top-left)      title    (top-right)
       chapter (bottom-left)  prev/next (bottom-right) */
  function headGrid(chapter, title) {
    const site = el('a', { class: 'fl-cell fl-c-site', href: location.origin + '/', title: 'Go to ' + HOST }, [
      el('span', { class: 'fl-cell-value', text: HOST }),
    ]);
    const titleCell = el('div', { class: 'fl-cell fl-c-title' }, [
      el('h1', { class: 'fl-title', text: title || (chapter ? 'Chapter ' + chapter : HOST) }),
    ]);
    const chapterCell = el('div', { class: 'fl-cell fl-c-chapter' }, [
      el('span', { class: 'fl-cell-value', text: chapter ? 'Chapter ' + chapter : '—' }),
    ]);
    const navCell = el('div', { class: 'fl-cell fl-c-nav' }, [
      el('div', { class: 'fl-nav' }, [
        navPill(nav.prev, '&larr;&nbsp; Previous', goPrev),
        navPill(nav.next, 'Next &nbsp;&rarr;', goNext),
      ]),
    ]);
    return el('div', { id: 'flyleaf-head' }, [site, titleCell, chapterCell, navCell]);
  }

  function ensureStyle() {
    if (!document.getElementById('flyleaf-style')) {
      const style = el('style', { id: 'flyleaf-style' });
      style.textContent = FLYLEAF_CSS;
      document.documentElement.appendChild(style);
    }
  }

  function openReader(quiet, fresh) {
    if (reader) return true;
    const article = extract();
    if (!article || !article.node.textContent.trim()) {
      if (!quiet) {
        curtainOff();
        toast('Flyleaf: no readable chapter found on this page');
      }
      return false;
    }
    /* after an SPA nav we want the NEW chapter; if the page still shows
       the one we just left (visible-chapter swap not done yet), report
       "not ready" so autoOpen retries until it changes. */
    const sig = (article.title || '') + '|' +
      article.node.textContent.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (fresh && sig === lastSig) return false;
    lastSig = sig;
    nav = findNav();
    ensureStyle();

    const h1 = document.querySelector('h1');
    const fullTitle =
      article.title ||
      (h1 && h1.textContent.trim()) ||
      document.title.split(/[|\-–—]/)[0].trim();
    const parts = splitChapter(fullTitle);

    reader = el('div', { id: 'flyleaf-reader' }, [
      el('div', { id: 'flyleaf-sheet' }, [
        el('div', { id: 'flyleaf-page' }, [
          headGrid(parts.chapter, parts.title),
          el('div', { id: 'flyleaf-body' }, [article.node]),
          navBar(),
        ]),
      ]),
    ]);
    progress = el('div', { id: 'flyleaf-progress' });

    document.documentElement.appendChild(reader);
    document.documentElement.appendChild(progress);
    document.documentElement.classList.add('flyleaf-on');

    savedScroll = window.pageYOffset;
    /* the site's body is only hidden (by the .flyleaf-on rule), never
       removed — so leaving the reader restores it instantly */
    applyPrefs();
    window.scrollTo(0, 0);
    curtainOff();
    endNav(); /* new chapter is up — release the nav lock */
    /* clear a lingering "Loading…" toast after a click-based (SPA) chapter
       change re-opens the reader — there's no page reload to clear it */
    if (toastEl) { clearTimeout(toastTimer); toastEl.classList.remove('fl-show'); }
    try { sessionStorage.setItem('flyleaf-active', '1'); } catch (e) {}
    return true;
  }

  /* ---- scroll sync: page follows reader on close ----
     When you leave the reader, the site is lined up with what you were
     reading — matched by the text of the paragraph at the top of the
     reader viewport, found again in the original page. */
  const BLOCK_SEL = 'p, h1, h2, h3, h4, li, blockquote';
  const READER_BLOCK_SEL = BLOCK_SEL.split(', ').map((s) => '#flyleaf-body ' + s).join(', ');
  const sigOf = (node) => {
    const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length >= 12 ? t : null;
  };
  /* the block currently sitting at the top of the viewport */
  function topSignature(nodes) {
    let top = null;
    for (const b of nodes) {
      const r = b.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom >= 60) { top = b; break; }
    }
    if (!top) top = nodes[0];
    return top ? sigOf(top) : null;
  }
  /* the element whose paragraph starts with the same text */
  function firstWithText(nodes, sig) {
    const needle = sig.slice(0, 60).toLowerCase();
    if (needle.length < 8) return null;
    for (const node of nodes) {
      if (node.closest && node.closest('[id^="flyleaf-"]')) continue;
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t && t.includes(needle)) return node;
    }
    return null;
  }
  /* the Safari "close" motion: the reader slides down out of view,
     revealing the page underneath, then is removed. */
  function dropAway(node, done) {
    let reduce = false;
    try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) {
      node.remove();
      if (done) done();
      return;
    }
    requestAnimationFrame(() => {
      node.style.transition = 'transform .36s cubic-bezier(.32,.72,.35,1), opacity .36s ease';
      node.style.transform = (node.style.transform ? node.style.transform + ' ' : '') + 'translateY(100%)';
      node.style.opacity = '0.7';
    });
    setTimeout(() => {
      node.remove();
      if (done) done();
    }, 400);
  }

  function closeReader() {
    endNav(); /* leaving the reader clears any pending nav lock */
    if (!reader) {
      if (progress) progress.remove();
      progress = null;
      document.documentElement.classList.remove('flyleaf-on');
      return;
    }

    /* capture reading position, freeze the reader as a fixed overlay
       showing the same content, reveal + line up the original page
       underneath, then let the reader fall away over it. */
    const anchor = topSignature(document.querySelectorAll(READER_BLOCK_SEL));
    const scrolledBy = window.pageYOffset;
    const sheet = reader.querySelector('#flyleaf-sheet');
    reader.style.position = 'fixed';
    reader.style.left = '0';
    reader.style.right = '0';
    reader.style.top = '0';
    reader.style.height = '100vh';
    reader.style.margin = '0';
    reader.style.overflow = 'hidden';
    reader.style.zIndex = '2147483646';
    if (sheet) sheet.style.transform = 'translateY(' + -scrolledBy + 'px)';

    document.documentElement.classList.remove('flyleaf-on');
    if (progress) progress.remove();
    let y = savedScroll;
    if (anchor) {
      const target = firstWithText(document.body.querySelectorAll(BLOCK_SEL), anchor);
      if (target) y = Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - 80);
    }
    window.scrollTo(0, y);

    const gone = reader;
    reader = null;
    progress = null;
    dropAway(gone);
  }

  async function setEnabled(on) {
    if (on) {
      if (!openReader()) return;
      /* first time enabling this site: remember which kind of page this
         is, so reload / auto-open fires on chapters but not the home. */
      const patch = { enabled: true };
      if (siteCfg().pattern === undefined) patch.pattern = seedPattern();
      await saveSite(patch);
    } else {
      await saveSite({ enabled: false });
      try { sessionStorage.removeItem('flyleaf-active'); } catch (e) {}
      closeReader();
    }
  }

  /* ---------------- element picker (train prev/next per site) ------------ */

  let picking = null; /* 'prev' | 'next' | null */
  let pickBox = null;
  let pickTip = null;

  /* A stable id / rel / semantic-class selector that uniquely resolves to
     this element now, or null. No structural :nth-child path — that lives
     in pathSelector, so callers can prefer link text over a brittle path. */
  function stableSelector(link) {
    const tag = link.localName; /* 'a' for links, 'button' for JS controls */
    const candidates = [];
    if (link.id) candidates.push('#' + CSS.escape(link.id));
    const rel = link.getAttribute('rel');
    if (rel) candidates.push(tag + '[rel="' + CSS.escape(rel) + '"]');
    /* class candidates must be SEMANTIC, not utility soup: Tailwind
       variant classes (disabled:opacity-50, [&_svg]:size-4, …) are
       unique-but-meaningless and produce monster selectors. Keep only
       plain word-like classes, at most three, and cap total length. */
    const semantic = (c) => /^[a-z][\w-]*$/i.test(c) && !/^(active|current|\d)/i.test(c);
    const classes = [...link.classList].filter(semantic).slice(0, 3);
    if (classes.length) {
      candidates.push(tag + '.' + classes.map((c) => CSS.escape(c)).join('.'));
    }
    const parent = link.parentElement;
    if (parent) {
      const pc = [...parent.classList].filter(semantic).slice(0, 2);
      if (pc.length) {
        candidates.push('.' + pc.map((c) => CSS.escape(c)).join('.') + ' ' + tag);
      }
    }
    for (const sel of candidates) {
      if (sel.length > 80) continue;
      try {
        /* require an UNAMBIGUOUS match: a selector that resolves to several
           elements (e.g. ".nav a" for a "prev | toc | next" row) only works
           by being first, and breaks when the layout shifts — prefer text
           or a structural path over that. */
        const m = document.querySelectorAll(sel);
        if (m.length === 1 && m[0] === link) return sel;
      } catch {
        /* invalid selector — skip */
      }
    }
    return null;
  }
  const selectorFor = (link) => stableSelector(link) || pathSelector(link);

  /* would matching by exact text (as findNav does) land on THIS element?
     i.e. is the link/button text an unambiguous locator for it */
  function textResolvesTo(el, text, isLink) {
    for (const n of document.querySelectorAll(isLink ? 'a[href]' : 'button, [role="button"], a')) {
      if (!notFlyleaf(n)) continue;
      if ((n.textContent || '').replace(/\s+/g, ' ').trim() === text) return n === el;
    }
    return false;
  }

  function pathSelector(link) {
    /* structural fallback: an :nth-child path from the nearest ancestor
       that has an id (or from body, capped at 5 hops). Survives across
       chapters as long as the nav layout is stable. */
    const steps = [];
    let node = link;
    for (let depth = 0; depth < 5 && node.parentElement; depth++) {
      const parent = node.parentElement;
      const idx = [...parent.children].indexOf(node) + 1;
      steps.unshift(node.localName + ':nth-child(' + idx + ')');
      if (parent.id) {
        const sel = '#' + CSS.escape(parent.id) + ' > ' + steps.join(' > ');
        try {
          if (document.querySelector(sel) === link) return sel;
        } catch { /* keep climbing */ }
      }
      node = parent;
    }
    const sel = 'body ' + steps.join(' > ');
    try {
      if (document.querySelector(sel) === link) return sel;
    } catch { /* fall through */ }
    return null;
  }

  const PICKABLE = 'a[href], button, [role="button"], [onclick]';
  function resolvePickTarget(target) {
    return (
      target.closest(PICKABLE) ||
      target.querySelector(PICKABLE) ||
      (target.parentElement && target.parentElement.closest(PICKABLE))
    );
  }

  function stopPicking() {
    picking = null;
    if (pickBox) pickBox.remove();
    if (pickTip) pickTip.remove();
    pickBox = null;
    pickTip = null;
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);
  }

  function onPickMove(e) {
    const link = resolvePickTarget(e.target);
    if (!link) {
      pickBox.style.width = '0px';
      pickBox.style.height = '0px';
      return;
    }
    const r = link.getBoundingClientRect();
    pickBox.style.left = r.left - 2 + 'px';
    pickBox.style.top = r.top - 2 + 'px';
    pickBox.style.width = r.width + 'px';
    pickBox.style.height = r.height + 'px';
  }

  async function onPickClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const link = resolvePickTarget(e.target);
    if (!link) {
      toast('Nothing clickable there — click the ' + picking + ' control');
      return;
    }
    const which = picking;
    const isLink = link.tagName === 'A' && /^https?:/i.test(link.href || '');
    /* Prefer, in order: a stable id/rel/class selector → the exact link
       text (survives when the nav layout shifts between chapters, e.g. a
       first/last chapter with fewer links) → a structural path as a last
       resort. Chapter-nav links like "Next Chapter" usually only have
       stable TEXT, so text beats a brittle :nth-child path here. */
    const stable = stableSelector(link);
    const full = (link.textContent || '').replace(/\s+/g, ' ').trim();
    const text = full.length && full.length <= 60 && textResolvesTo(link, full, isLink) ? full : null;
    let sel;
    if (isLink) {
      sel = stable || (text ? 'text:' + text : pathSelector(link));
    } else {
      /* button / JS control (prefix "click:" / "click-text:") */
      if (stable) sel = 'click:' + stable;
      else if (text) sel = 'click-text:' + text;
      else { const p = pathSelector(link); sel = p ? 'click:' + p : null; }
    }
    stopPicking();
    if (!sel) {
      toast('Could not build a stable locator for that control');
      return;
    }
    await saveSite(which === 'prev' ? { prevSel: sel } : { nextSel: sel });
    const brief = /^(text|click-text):/.test(sel)
      ? '“' + sel.replace(/^(text|click-text):/, '') + '”'
      : sel.replace(/^click:/, '').slice(0, 43);
    toast('Saved ' + which + ' → ' + brief);
    /* return to the reader if we stepped out of it to pick */
    if (sessionStorage.getItem('flyleaf-resume') === '1') {
      sessionStorage.removeItem('flyleaf-resume');
      setEnabled(true);
    } else if (reader) {
      nav = findNav();
      reader.querySelectorAll('.fl-nav').forEach((n) => n.replaceWith(navBar()));
    }
  }

  function onPickKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      stopPicking();
      toast('Pick cancelled');
    }
  }

  function startPicking(which) {
    /* the links live in the ORIGINAL page, so the site must be visible */
    if (reader) closeReaderKeepPrefs();
    picking = which;
    pickBox = el('div', { id: 'flyleaf-pick-box' });
    pickTip = el('div', {
      id: 'flyleaf-pick-tip',
      text: 'Click the “' + (which === 'prev' ? 'previous' : 'next') + ' chapter” link or button · Esc to cancel',
    });
    document.documentElement.appendChild(pickBox);
    document.documentElement.appendChild(pickTip);
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  }

  function closeReaderKeepPrefs() {
    /* leave reader without flipping the per-site enabled flag (modal only) */
    if (reader) reader.remove();
    if (progress) progress.remove();
    reader = null;
    progress = null;
    document.documentElement.classList.remove('flyleaf-on');
    window.scrollTo(0, savedScroll);
    sessionStorage.setItem('flyleaf-resume', '1');
  }

  /* ---------------- keys ---------------- */

  function isTyping(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function stepZoom(dir) {
    let i = ZOOM_STEPS.indexOf(eff('zoom'));
    if (i === -1) i = ZOOM_STEPS.indexOf(100);
    i = Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
    const zoom = ZOOM_STEPS[i];
    saveSite({ zoom }); /* per-site */
    applyPrefs();
    toast('Zoom ' + zoom + '%');
  }

  const KEY_ACTIONS = {
    ArrowLeft: () => goPrev(),
    ArrowRight: () => goNext(),
    Escape: () => setEnabled(false),
    '-': () => stepZoom(-1),
    _: () => stepZoom(-1),
    '+': () => stepZoom(1),
    '=': () => stepZoom(1),
  };
  /* While the reader is up, Flyleaf is the sole driver of these keys. The
     listener is on window in the capture phase, registered at
     document_start (before the page's), and stopImmediatePropagation runs
     on all three keyboard events (keydown/keypress/keyup) — the full set —
     so a site that binds its own arrow-key nav (to any of them) can't also
     navigate. We act on keydown; keypress/keyup are swallowed silently. */
  const owns = (e) =>
    (reader || navigating) && !picking && !e.ctrlKey && !e.metaKey && !e.altKey &&
    !isTyping(e.target) && KEY_ACTIONS[e.key] !== undefined;

  window.addEventListener('keydown', (e) => {
    if (!owns(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    KEY_ACTIONS[e.key]();
  }, true);

  /* suppress the site's handler on the other two events; take no action */
  const swallow = (e) => {
    if (!owns(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keypress', swallow, true);
  window.addEventListener('keyup', swallow, true);

  /* ---------------- scroll progress ---------------- */

  window.addEventListener(
    'scroll',
    () => {
      if (!progress) return;
      const d = document.documentElement;
      const max = d.scrollHeight - d.clientHeight || 1;
      progress.style.width = Math.min(100, (window.pageYOffset / max) * 100) + '%';
    },
    { passive: true }
  );

  /* ---------------- SPA navigation ---------------- */

  let lastHref = location.href;
  function onNav() {
    /* only a REAL url change counts: Inertia-style routers call
       replaceState on every scroll to record scroll position */
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (reader) {
      /* re-extract for the new chapter behind the curtain; fresh=true so
         we wait for the extracted chapter to actually change (some sites
         swap the visible chapter shortly after the URL does) */
      curtainOn();
      if (reader) reader.remove();
      if (progress) progress.remove();
      reader = null;
      progress = null;
      document.documentElement.classList.remove('flyleaf-on');
      autoOpen(0, true);
    } else if (shouldAutoOpen()) {
      curtainOn();
      autoOpen();
    }
  }
  /* A content script can't wrap the page's history.pushState (it runs in
     an isolated world), so SPA URL changes wouldn't reach onNav. Poll
     location.href instead — reliable regardless of how the site routes. */
  window.addEventListener('popstate', onNav);
  setInterval(() => {
    if (location.href !== lastHref) onNav();
  }, 350);

  /* ---------------- boot ---------------- */

  function autoOpen(tries = 0, fresh = false) {
    /* wait up to ~3s for genuinely-new content after a chapter change,
       then render whatever is there so the reader can never freeze */
    if (openReader(true, fresh && tries < 10)) return;
    if (tries < 50) {
      setTimeout(() => autoOpen(tries + 1, fresh), 300); /* ~15s of retries */
    } else {
      curtainOff(); /* genuinely no article here — reveal the site */
    }
  }

  function waitForContent(fn, tries = 0) {
    if (pageHasContent()) {
      fn();
      return;
    }
    if (tries < 40) setTimeout(() => waitForContent(fn, tries + 1), 300);
    else curtainOff();
  }

  function refreshNavUi() {
    nav = findNav();
    if (reader) reader.querySelectorAll('.fl-nav').forEach((n) => n.replaceWith(navBar()));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return undefined;
    switch (msg.type) {
      case 'flyleaf-toggle':
        if (reader) setEnabled(false);
        else waitForContent(() => setEnabled(true));
        break;
      case 'flyleaf-status': {
        const detected = findNav();
        sendResponse({
          active: !!reader,
          host: HOST,
          enabled: !!siteCfg().enabled,
          prevSel: siteCfg().prevSel || null,
          nextSel: siteCfg().nextSel || null,
          prevFound: !!detected.prev,
          nextFound: !!detected.next,
          pattern: siteCfg().pattern || '',
          path: location.pathname,
          suggest: seedPattern(),
          patternMatches: urlMatches(siteCfg().pattern),
          /* effective per-site reading prefs (site override, else global) */
          font: eff('font'),
          zoom: eff('zoom'),
          lh: eff('lh'),
        });
        break;
      }
      case 'flyleaf-set-enabled':
        if (msg.on) waitForContent(() => setEnabled(true));
        else setEnabled(false);
        sendResponse({ ok: true });
        break;
      case 'flyleaf-pick':
        startPicking(msg.which === 'prev' ? 'prev' : 'next');
        sendResponse({ ok: true });
        break;
      case 'flyleaf-set-pattern':
        saveSite({ pattern: typeof msg.pattern === 'string' ? msg.pattern.trim() : '' });
        sendResponse({ ok: true });
        break;
      case 'flyleaf-set-site-pref':
        if (SITE_PREF_KEYS.includes(msg.key)) {
          saveSite({ [msg.key]: msg.value });
          applyPrefs();
        }
        sendResponse({ ok: true });
        break;
      case 'flyleaf-reset-nav':
        saveSite({ prevSel: null, nextSel: null }).then(() => {
          refreshNavUi();
          toast('Back to auto-detection');
        });
        sendResponse({ ok: true });
        break;
    }
    return undefined;
  });

  /* the popup writes prefs to storage; apply them live here */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.prefs) {
      prefs = { ...DEFAULT_PREFS, ...(changes.prefs.newValue || {}) };
      applyPrefs();
    }
    if (changes.sites) {
      sites = changes.sites.newValue || {};
      applyPrefs(); /* per-site font/zoom/lh may have changed */
      if (reader) refreshNavUi();
    }
  });

  function boot() {
    applyPrefs();
    ensureStyle();
    if (shouldAutoOpen()) {
      autoOpen();
    }
  }

  function shouldAutoOpen() {
    const cfg = siteCfg();
    if (cfg.enabled && urlMatches(cfg.pattern)) return true;
    /* in-tab continuation (next/prev, reload) — but still only on pages
       that match the site's reading pattern, so navigating to the home
       page inside the same tab drops the reader instead of blanking it. */
    try {
      if (sessionStorage.getItem('flyleaf-active') === '1') return urlMatches(cfg.pattern);
    } catch (e) {}
    return false;
  }

  /* Runs at document_start: storage resolves in a few ms, typically
     before the parser has produced anything paintable — so on enabled
     sites the curtain beats first paint and there is no flash. */
  (async function early() {
    prefs = { ...DEFAULT_PREFS, ...(await store.get('prefs', {})) };
    sites = await store.get('sites', {});
    if (shouldAutoOpen()) {
      curtainOn();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })();
})();
