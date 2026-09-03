/* Flyleaf — toolbar popup. All settings live here now (no in-page
   floater). Prefs write straight to chrome.storage.sync; the content
   script listens to storage changes and applies them live, so sliders
   preview in the page while the popup is open. Page actions (toggle,
   pick, reset) go over tab messages. */

const THEMES = {
  light: { bg: '#ffffff', check: '#111111' },
  sepia: { bg: '#f4ecd8', check: '#2c2518' },
  gray: { bg: '#46464a', check: '#ffffff' },
  midnight: { bg: '#101012', check: '#f2f2f3' },
};

const FONTS = {
  system: 'System (San Francisco)',
  charter: 'Charter',
  georgia: 'Georgia',
  iowan: 'Iowan Old Style',
  newyork: 'New York',
  palatino: 'Palatino',
  seravek: 'Seravek',
  athelas: 'Athelas',
  times: 'Times New Roman',
};

const ZOOM_STEPS = [50, 75, 85, 100, 115, 125, 150, 175, 200, 250, 300];
const DEFAULT_PREFS = { theme: 'midnight', font: 'system', zoom: 100, lh: 1.8, mode: 'modal' };

let prefs = { ...DEFAULT_PREFS };
let status = null; /* from the content script; null = not available here */
let tabId = null;

/* same glob->regex the content script uses, so the popup can show a live
   match indicator as you type without a round-trip */
function pathMatches(pattern, path) {
  if (!pattern) return true;
  try {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + esc + '$', 'i').test(path);
  } catch {
    return true;
  }
}

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

async function savePrefs() {
  await chrome.storage.sync.set({ prefs });
}

async function send(msg) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

function render() {
  const app = document.getElementById('app');
  app.replaceChildren();

  /* theme */
  app.appendChild(el('div', { class: 'fl-label', text: 'Theme' }));
  const sw = el('div', { class: 'fl-swatches' });
  for (const [key, t] of Object.entries(THEMES)) {
    const b = el('button', {
      class: 'fl-swatch' + (prefs.theme === key ? ' fl-active' : ''),
      title: key,
      text: prefs.theme === key ? '✓' : '',
      onclick: async () => { prefs.theme = key; await savePrefs(); render(); },
    });
    b.style.background = t.bg;
    b.style.color = t.check;
    sw.appendChild(b);
  }
  app.appendChild(sw);

  /* font */
  app.appendChild(el('div', { class: 'fl-label', text: 'Font' }));
  const sel = el('select');
  for (const [key, label] of Object.entries(FONTS)) {
    const o = el('option', { value: key, text: label });
    if (prefs.font === key) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', async () => { prefs.font = sel.value; await savePrefs(); });
  app.appendChild(sel);

  /* zoom (Safari-style) */
  app.appendChild(el('div', { class: 'fl-label', text: 'Zoom' }));
  const stepZoom = async (dir) => {
    let i = ZOOM_STEPS.indexOf(prefs.zoom);
    if (i === -1) i = ZOOM_STEPS.indexOf(100);
    i = Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
    prefs.zoom = ZOOM_STEPS[i];
    await savePrefs();
    render();
  };
  app.appendChild(
    el('div', { class: 'fl-stepper' }, [
      el('button', { text: '−', onclick: () => stepZoom(-1) }),
      el('div', { class: 'fl-val', text: prefs.zoom + '%' }),
      el('button', { text: '+', onclick: () => stepZoom(1) }),
    ])
  );

  /* line height */
  app.appendChild(el('div', { class: 'fl-label', text: 'Line height — ' + prefs.lh.toFixed(2) }));
  const lh = el('input', { type: 'range', min: 1.4, max: 2.3, step: 0.05, value: prefs.lh });
  lh.addEventListener('input', async () => {
    prefs.lh = parseFloat(lh.value);
    await savePrefs();
    lh.previousSibling.textContent = 'Line height — ' + prefs.lh.toFixed(2);
  });
  app.appendChild(lh);

  /* mode */
  app.appendChild(el('div', { class: 'fl-label', text: 'Reader replaces the page' }));
  const seg = el('div', { class: 'fl-seg' });
  for (const [key, label, hint] of [
    ['modal', 'Modal', 'site kept beneath; instant exit'],
    ['page', 'Page', 'site removed; exit reloads'],
  ]) {
    seg.appendChild(
      el('button', {
        class: prefs.mode === key ? 'fl-active' : '',
        text: label,
        title: hint,
        onclick: async () => { prefs.mode = key; await savePrefs(); render(); },
      })
    );
  }
  app.appendChild(seg);

  /* per-site settings — only when a content script answered */
  if (status) {
    /* auto-open scope: which pages of this site open in reader */
    app.appendChild(el('div', { class: 'fl-label', text: 'Auto-open on — ' + status.host }));
    const patInput = el('input', {
      type: 'text', class: 'fl-input',
      value: status.pattern || '',
      placeholder: 'whole site — e.g. /novel/*/chapter-*',
    });
    const patHint = el('div', { class: 'fl-nav-line' });
    const paintHint = () => {
      const p = patInput.value.trim();
      if (!p) {
        patHint.textContent = 'Opens on every page of this site.';
      } else {
        patHint.textContent =
          (pathMatches(p, status.path) ? 'This page matches ✓' : 'This page won’t auto-open ✗') +
          '  ·  ' + status.path;
      }
      patHint.title = status.path;
    };
    let saveTimer;
    const savePattern = (v) => send({ type: 'flyleaf-set-pattern', pattern: v });
    patInput.addEventListener('input', () => {
      paintHint();
      clearTimeout(saveTimer);
      const v = patInput.value.trim();
      saveTimer = setTimeout(() => savePattern(v), 350);
    });
    paintHint();
    app.appendChild(patInput);
    app.appendChild(patHint);
    app.appendChild(
      el('div', { class: 'fl-row2' }, [
        el('button', {
          class: 'fl-btn', text: 'Use this page',
          title: 'Auto-open on pages like the one you’re reading now',
          onclick: async () => { patInput.value = status.suggest || status.path; paintHint(); await savePattern(patInput.value); },
        }),
        el('button', {
          class: 'fl-btn', text: 'Whole site',
          title: 'Auto-open on every page of this site',
          onclick: async () => { patInput.value = ''; paintHint(); await savePattern(''); },
        }),
      ])
    );

    app.appendChild(el('div', { class: 'fl-label', text: 'Chapter links — ' + status.host }));
    app.appendChild(
      el('div', { class: 'fl-row2' }, [
        el('button', { class: 'fl-btn', text: 'Pick “previous”', onclick: async () => { await send({ type: 'flyleaf-pick', which: 'prev' }); window.close(); } }),
        el('button', { class: 'fl-btn', text: 'Pick “next”', onclick: async () => { await send({ type: 'flyleaf-pick', which: 'next' }); window.close(); } }),
        el('button', { class: 'fl-btn', text: 'Reset', title: 'Forget trained links, use auto-detection', onclick: async () => { await send({ type: 'flyleaf-reset-nav' }); refreshStatus(); } }),
      ])
    );
    /* summarize a saved locator to one short line; full value on hover */
    const summarize = (sel) => {
      if (sel.startsWith('text:')) return '“' + sel.slice(5).slice(0, 22) + '”';
      if (sel[0] === '#') return sel.split(/[ >]/)[0];               // id
      const relm = sel.match(/\[rel="?([^"\]]+)"?\]/);
      if (relm) return 'rel=' + relm[1];
      if (/:nth-child|^body /.test(sel)) return 'by position';        // path
      const m = sel.match(/^([a-z]*)\.(.+)$/i);                       // tag.classes
      if (m) {
        const cls = m[2].split('.');
        return (m[1] || '') + '.' + cls[0] + (cls.length > 1 ? ' +' + (cls.length - 1) : '');
      }
      return sel.length > 24 ? sel.slice(0, 22) + '…' : sel;
    };
    const line = (arrow, sel, found) => {
      const div = el('div', { class: 'fl-nav-line' });
      if (sel) {
        div.textContent = arrow + ' custom: ' + summarize(sel);
        div.title = sel;                                              // full on hover
      } else {
        div.textContent = arrow + ' auto' + (found ? ' ✓' : ' (not found)');
      }
      return div;
    };
    const status_ = el('div', { class: 'fl-nav-status' }, [
      line('←', status.prevSel, status.prevFound),
      line('→', status.nextSel, status.nextFound),
    ]);
    app.appendChild(status_);
  }

  /* primary action */
  const primary = el('button', {
    class: 'fl-primary',
    text: status ? (status.active ? 'Hide Reader' : 'Show Reader') : 'Flyleaf can’t run on this page',
    onclick: async () => {
      if (!status) return;
      await send({ type: 'flyleaf-set-enabled', on: !status.active });
      /* stay open — just flip the button once the reader settles.
         Opening waits for page content, so poll status twice. */
      setTimeout(refreshStatus, 200);
      setTimeout(refreshStatus, 900);
    },
  });
  if (!status) primary.disabled = true;
  app.appendChild(primary);

  app.appendChild(
    el('div', {
      class: 'fl-hint',
      html: 'In reader: <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>−</kbd>/<kbd>+</kbd> zoom · <kbd>Esc</kbd> hide<br><kbd>Alt+R</kbd> toggles from anywhere',
    })
  );
}

async function refreshStatus() {
  status = await send({ type: 'flyleaf-status' });
  render();
}

(async function init() {
  const stored = await chrome.storage.sync.get('prefs');
  prefs = { ...DEFAULT_PREFS, ...(stored.prefs || {}) };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id != null ? tab.id : null;
  render();
  refreshStatus();
})();
