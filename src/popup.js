/* Flyleaf — toolbar popup. All settings live here now (no in-page
   floater). Prefs write straight to chrome.storage.sync; the content
   script listens to storage changes and applies them live, so sliders
   preview in the page while the popup is open. Page actions (toggle,
   pick, reset) go over tab messages. */

const THEMES = {
  light: { bg: '#ffffff', check: '#111111' },
  sepia: { bg: '#f2ecdb', check: '#2f2818' },
  gray: { bg: '#48484c', check: '#f2f2f3' },
  midnight: { bg: '#000000', check: '#ededed' },
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

const DEFAULT_PREFS = { theme: 'midnight', font: 'system', size: 18, margin: 22, lh: 1.8, mode: 'modal' };

let prefs = { ...DEFAULT_PREFS };
let status = null; /* from the content script; null = not available here */
let tabId = null;

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

  /* text size */
  app.appendChild(el('div', { class: 'fl-label', text: 'Text size' }));
  const bump = async (d) => {
    prefs.size = Math.min(42, Math.max(14, prefs.size + d));
    await savePrefs();
    render();
  };
  app.appendChild(
    el('div', { class: 'fl-stepper' }, [
      el('button', { text: 'A−', onclick: () => bump(-1) }),
      el('div', { class: 'fl-val', text: prefs.size + 'px' }),
      el('button', { text: 'A+', onclick: () => bump(1) }),
    ])
  );

  /* width + line height */
  app.appendChild(el('div', { class: 'fl-label', text: 'Page margins — ' + prefs.margin + '%' }));
  const margin = el('input', { type: 'range', min: 0, max: 36, step: 1, value: prefs.margin });
  margin.addEventListener('input', async () => {
    prefs.margin = parseInt(margin.value, 10);
    await savePrefs();
    margin.previousSibling.textContent = 'Page margins — ' + prefs.margin + '%';
  });
  app.appendChild(margin);

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

  /* per-site nav — only when a content script answered */
  if (status) {
    app.appendChild(el('div', { class: 'fl-label', text: 'Chapter links — ' + status.host }));
    app.appendChild(
      el('div', { class: 'fl-row2' }, [
        el('button', { class: 'fl-btn', text: 'Pick “previous”', onclick: async () => { await send({ type: 'flyleaf-pick', which: 'prev' }); window.close(); } }),
        el('button', { class: 'fl-btn', text: 'Pick “next”', onclick: async () => { await send({ type: 'flyleaf-pick', which: 'next' }); window.close(); } }),
        el('button', { class: 'fl-btn', text: 'Reset', title: 'Forget trained links, use auto-detection', onclick: async () => { await send({ type: 'flyleaf-reset-nav' }); refreshStatus(); } }),
      ])
    );
    const pretty = (sel) => {
      if (!sel) return null;
      if (sel.startsWith('text:')) return 'link text “' + sel.slice(5) + '”';
      return sel.length > 46 ? sel.slice(0, 30) + '…' + sel.slice(-13) : sel;
    };
    const lines = [
      status.prevSel ? '← custom: ' + pretty(status.prevSel) : '← auto' + (status.prevFound ? ' ✓' : ' (not found)'),
      status.nextSel ? '→ custom: ' + pretty(status.nextSel) : '→ auto' + (status.nextFound ? ' ✓' : ' (not found)'),
    ];
    app.appendChild(el('div', { class: 'fl-nav-status', text: lines.join('\n') }));
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
      html: 'In reader: <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>−</kbd>/<kbd>+</kbd> size · <kbd>Esc</kbd> hide<br><kbd>Alt+R</kbd> toggles from anywhere',
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
