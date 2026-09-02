/* Flyleaf — content script.
   Safari-style reader mode for serialized fiction.

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
   - Page mode removes the site's DOM outright (exit = reload);
     modal mode hides it (exit = instant restore). */

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
    light: { backdrop: '#eeeeee', bg: '#ffffff', edge: 'rgba(0,0,0,0.08)', text: '#333333', strong: '#111111', muted: '#666666', dim: '#999999', border: '#e4e4e4', borderHi: '#cccccc', chip: '#f5f5f5', progress: '#999999' },
    sepia: { backdrop: '#e7ddc4', bg: '#f6efdd', edge: 'rgba(120,100,60,0.18)', text: '#4a4030', strong: '#2f2818', muted: '#7a6f58', dim: '#9c9077', border: '#e0d5bb', borderHi: '#c9bd9f', chip: '#ede3cc', progress: '#9c9077' },
    gray: { backdrop: '#313135', bg: '#4b4b50', edge: 'rgba(255,255,255,0.06)', text: '#d6d6d8', strong: '#f2f2f3', muted: '#a9a9ad', dim: '#8b8b90', border: '#5a5a60', borderHi: '#6d6d73', chip: '#434347', progress: '#a9a9ad' },
    midnight: { backdrop: '#000000', bg: '#0b0b0c', edge: 'rgba(255,255,255,0.06)', text: '#d4d4d4', strong: '#ededed', muted: '#a1a1a1', dim: '#707070', border: '#1f1f1f', borderHi: '#2e2e2e', chip: '#131314', progress: '#ffffff' },
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

  const DEFAULT_PREFS = {
    theme: 'midnight',
    font: 'system',
    size: 18,
    width: 680,
    lh: 1.8,
    mode: 'modal', /* 'modal' hides the site DOM; 'page' removes it */
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
    let len = 0;
    document.querySelectorAll('p').forEach((p) => (len += p.textContent.length));
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
    const marked = markHidden();
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

  /* ---------------- prev / next ---------------- */

  const norm = (u) => (u ? u.replace(/[#?].*$/, '').replace(/\/$/, '') : null);
  function notSelf(a) {
    if (!a || !/^https?:/i.test(a.href || '')) return null;
    return norm(a.href) === norm(location.href) ? null : a.href;
  }

  function findNav() {
    const cfg = siteCfg();
    const q = (sel) => {
      if (!sel) return null;
      /* "text:..." locators come from the picker when no unique CSS
         selector exists (Tailwind-style sites: shared utility classes,
         no ids). Link text like "Next →" is stable across chapters. */
      if (sel.startsWith('text:')) {
        const want = sel.slice(5);
        for (const a of document.querySelectorAll('a[href]')) {
          if (a.closest('[id^="flyleaf-"]')) continue;
          if ((a.textContent || '').replace(/\s+/g, ' ').trim() === want) {
            const u = notSelf(a);
            if (u) return u;
          }
        }
        return null;
      }
      try {
        return notSelf(document.querySelector(sel));
      } catch {
        return null;
      }
    };
    const byText = (re) => {
      for (const a of document.querySelectorAll('a[href]')) {
        if (a.closest('[id^="flyleaf-"]')) continue;
        const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length && t.length < 40 && re.test(t)) {
          const u = notSelf(a);
          if (u) return u;
        }
      }
      return null;
    };
    return {
      /* user-trained selector first, then the composite auto-detector */
      prev:
        q(cfg.prevSel) ||
        q('a[rel~="prev"]') || q('.nav-previous a') || q('a.nav-previous') ||
        q('a.prev_page') || q('a.chnav.prev') ||
        byText(/^(<|«|‹)?\s*prev(ious)?(\s*(chapter|post|page))?\s*$/i) ||
        byText(/prev(ious)?\s*chapter/i),
      next:
        q(cfg.nextSel) ||
        q('a[rel~="next"]') || q('.nav-next a') || q('a.nav-next') ||
        q('a.next_page') || q('a.chnav.next') ||
        byText(/^\s*next(\s*(chapter|post|page))?\s*(>|»|›)?\s*$/i) ||
        byText(/next\s*chapter/i),
    };
  }

  /* ---------------- reader ---------------- */

  let reader = null;
  let progress = null;
  let nav = { prev: null, next: null };
  let savedScroll = 0;
  let bodyWasRemoved = false;

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
    st.setProperty('--fl-font', (FONTS[prefs.font] || FONTS.system).stack);
    st.setProperty('--fl-size', prefs.size + 'px');
    st.setProperty('--fl-width', prefs.width + 'px');
    st.setProperty('--fl-lh', String(prefs.lh));
  }

  function navBar() {
    const pill = (url, html) => {
      const n = el(url ? 'a' : 'span', { class: 'fl-pill', html });
      if (url) n.setAttribute('href', url);
      return n;
    };
    return el('div', { class: 'fl-nav' }, [
      pill(nav.prev, '&larr;&nbsp; Previous'),
      pill(nav.next, 'Next &nbsp;&rarr;'),
    ]);
  }

  function ensureStyle() {
    if (!document.getElementById('flyleaf-style')) {
      const style = el('style', { id: 'flyleaf-style' });
      style.textContent = FLYLEAF_CSS;
      document.documentElement.appendChild(style);
    }
  }

  function openReader() {
    if (reader) return true;
    const article = extract();
    if (!article || !article.node.textContent.trim()) {
      toast('Flyleaf: no readable chapter found on this page');
      return false;
    }
    nav = findNav();
    ensureStyle();

    const h1 = document.querySelector('h1');
    const title =
      article.title ||
      (h1 && h1.textContent.trim()) ||
      document.title.split(/[|\-–—]/)[0].trim();

    reader = el('div', { id: 'flyleaf-reader' }, [
      el('div', { id: 'flyleaf-sheet' }, [
      el('div', { id: 'flyleaf-page' }, [
        el('p', { class: 'fl-site', text: HOST }),
        el('h1', { class: 'fl-title', text: title }),
        navBar(),
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
    if (prefs.mode === 'page') {
      /* the site's DOM is REMOVED — zero layout/paint/compositing left.
         Exit brings it back via reload. */
      document.body.replaceChildren();
      bodyWasRemoved = true;
    }
    /* modal mode: body is only hidden by the .flyleaf-on rule */

    applyPrefs();
    window.scrollTo(0, 0);
    return true;
  }

  function closeReader() {
    if (reader) reader.remove();
    if (progress) progress.remove();
    reader = null;
    progress = null;
    document.documentElement.classList.remove('flyleaf-on');
    if (bodyWasRemoved) {
      location.reload();
      return;
    }
    window.scrollTo(0, savedScroll);
  }

  async function setEnabled(on) {
    if (on) {
      if (!openReader()) return;
      await saveSite({ enabled: true });
    } else {
      await saveSite({ enabled: false });
      closeReader();
    }
  }

  /* ---------------- element picker (train prev/next per site) ------------ */

  let picking = null; /* 'prev' | 'next' | null */
  let pickBox = null;
  let pickTip = null;

  function selectorFor(link) {
    /* Build a selector that should survive across chapters. Prefer
       stable signals; validate that it resolves to this link now. */
    const candidates = [];
    if (link.id) candidates.push('#' + CSS.escape(link.id));
    const rel = link.getAttribute('rel');
    if (rel) candidates.push('a[rel="' + CSS.escape(rel) + '"]');
    /* class candidates must be SEMANTIC, not utility soup: Tailwind
       variant classes (disabled:opacity-50, [&_svg]:size-4, …) are
       unique-but-meaningless and produce monster selectors. Keep only
       plain word-like classes, at most three, and cap total length. */
    const semantic = (c) => /^[a-z][\w-]*$/i.test(c) && !/^(active|current|\d)/i.test(c);
    const classes = [...link.classList].filter(semantic).slice(0, 3);
    if (classes.length) {
      candidates.push('a.' + classes.map((c) => CSS.escape(c)).join('.'));
    }
    const parent = link.parentElement;
    if (parent) {
      const pc = [...parent.classList].filter(semantic).slice(0, 2);
      if (pc.length) {
        candidates.push('.' + pc.map((c) => CSS.escape(c)).join('.') + ' a');
      }
    }
    for (const sel of candidates) {
      if (sel.length > 80) continue;
      try {
        if (document.querySelector(sel) === link) return sel;
      } catch {
        /* invalid selector — skip */
      }
    }
    return pathSelector(link);
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

  function resolveLink(target) {
    return (
      target.closest('a[href]') ||
      target.querySelector('a[href]') ||
      (target.parentElement && target.parentElement.closest('a[href]'))
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
    const link = resolveLink(e.target);
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
    const link = resolveLink(e.target);
    if (!link) {
      toast('No link there — click on or near the ' + picking + ' link');
      return;
    }
    const which = picking;
    let sel = selectorFor(link);
    if (!sel) {
      /* last resort: match by exact link text across chapters */
      const t = (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (t) sel = 'text:' + t;
    }
    stopPicking();
    if (!sel) {
      toast('Could not build a stable locator for that link');
      return;
    }
    await saveSite(which === 'prev' ? { prevSel: sel } : { nextSel: sel });
    const brief = sel.startsWith('text:')
      ? 'link text “' + sel.slice(5) + '”'
      : (sel.length > 46 ? sel.slice(0, 43) + '…' : sel);
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
    if (reader) {
      if (bodyWasRemoved) {
        /* page mode destroyed the DOM — reload raw, then resume picking */
        sessionStorage.setItem('flyleaf-pick', which);
        sessionStorage.setItem('flyleaf-resume', '1');
        location.reload();
        return;
      }
      closeReaderKeepPrefs();
    }
    picking = which;
    pickBox = el('div', { id: 'flyleaf-pick-box' });
    pickTip = el('div', {
      id: 'flyleaf-pick-tip',
      text: 'Click the “' + (which === 'prev' ? 'previous' : 'next') + ' chapter” link · Esc to cancel',
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

  document.addEventListener(
    'keydown',
    (e) => {
      if (!reader || picking) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          if (nav.prev) {
            toast('Loading previous chapter…', true);
            location.href = nav.prev;
          } else toast('No previous chapter');
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          if (nav.next) {
            toast('Loading next chapter…', true);
            location.href = nav.next;
          } else toast('No next chapter');
          break;
        case 'Escape':
          e.preventDefault();
          setEnabled(false);
          break;
        case '-':
        case '_':
          e.preventDefault();
          prefs.size = Math.max(14, prefs.size - 1);
          applyPrefs();
          store.set('prefs', prefs);
          toast('Text ' + prefs.size + 'px');
          break;
        case '+':
        case '=':
          e.preventDefault();
          prefs.size = Math.min(42, prefs.size + 1);
          applyPrefs();
          store.set('prefs', prefs);
          toast('Text ' + prefs.size + 'px');
          break;
      }
    },
    true
  );

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
      /* re-extract for the new chapter */
      const wasRemoved = bodyWasRemoved;
      if (reader) reader.remove();
      if (progress) progress.remove();
      reader = null;
      progress = null;
      document.documentElement.classList.remove('flyleaf-on');
      bodyWasRemoved = wasRemoved && false;
      waitForContent(() => openReader());
    } else if (siteCfg().enabled) {
      waitForContent(() => openReader());
    }
  }
  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function (...args) {
    const r = _push.apply(this, args);
    onNav();
    return r;
  };
  history.replaceState = function (...args) {
    const r = _replace.apply(this, args);
    onNav();
    return r;
  };
  window.addEventListener('popstate', onNav);

  /* ---------------- boot ---------------- */

  function waitForContent(fn, tries = 0) {
    if (pageHasContent()) {
      fn();
      return;
    }
    if (tries < 40) setTimeout(() => waitForContent(fn, tries + 1), 300);
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
      if (reader) refreshNavUi();
    }
  });

  async function boot() {
    prefs = { ...DEFAULT_PREFS, ...(await store.get('prefs', {})) };
    sites = await store.get('sites', {});
    applyPrefs();
    ensureStyle();

    /* resume a pick that needed a raw page (page mode) */
    const pendingPick = sessionStorage.getItem('flyleaf-pick');
    if (pendingPick) {
      sessionStorage.removeItem('flyleaf-pick');
      waitForContent(() => startPicking(pendingPick));
      return;
    }

    if (siteCfg().enabled) {
      waitForContent(() => openReader());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
