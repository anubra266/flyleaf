/* Flyleaf — all injected CSS, kept out of the page until reader UI exists.
   Everything is scoped under #flyleaf-* ids; the reader surface resets
   inherited site styles with `all: revert` and re-styles from there.

   Root scrolling on purpose: the reader is an in-flow block and the
   DOCUMENT scrolls — the browser's fastest, always-threaded scroll path.
   No backdrop-filter anywhere: a blur over scrolling content re-blurs
   every frame and is the classic sticky-header jank. */

const FLYLEAF_CSS = `
:root.flyleaf-on { background: var(--fl-bg) !important; }
:root.flyleaf-on body { display: none !important; }

#flyleaf-reader {
  display: block;
  min-height: 100vh;
  background: var(--fl-bg);
  color: var(--fl-text);
  font-family: var(--fl-font);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
#flyleaf-reader * { all: revert; box-sizing: border-box; font-family: inherit; }

#flyleaf-page {
  max-width: var(--fl-width);
  margin: 0 auto;
  padding: 56px 24px 88px;
  font-size: var(--fl-size);
  line-height: var(--fl-lh);
  letter-spacing: 0.003em;
}

#flyleaf-reader .fl-site {
  font-size: 12px; font-weight: 500; letter-spacing: .05em;
  text-transform: uppercase; color: var(--fl-dim); margin: 0 0 10px;
}
#flyleaf-reader .fl-title {
  font-size: clamp(26px, 4vw, 38px); font-weight: 700;
  letter-spacing: -.03em; line-height: 1.15; color: var(--fl-strong);
  margin: 0 0 26px;
}

#flyleaf-reader .fl-nav {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 30px 0;
}
#flyleaf-reader .fl-card {
  display: flex; flex-direction: column; gap: 4px;
  background: var(--fl-chip); border: 1px solid var(--fl-border);
  border-radius: 12px; padding: 14px 18px; text-decoration: none;
  cursor: pointer; transition: border-color 120ms ease;
}
#flyleaf-reader a.fl-card:hover { border-color: var(--fl-border-hi); }
#flyleaf-reader span.fl-card { opacity: .35; cursor: default; }
#flyleaf-reader .fl-next { align-items: flex-end; text-align: right; }
#flyleaf-reader .fl-kick {
  font-size: 11px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase; color: var(--fl-dim);
}
#flyleaf-reader .fl-word { font-size: 15px; font-weight: 600; color: var(--fl-strong); }
@media (max-width: 560px) {
  #flyleaf-reader .fl-nav { grid-template-columns: 1fr; }
}

#flyleaf-body p { margin: 0 0 1.5em; color: var(--fl-text); }
#flyleaf-body h1, #flyleaf-body h2, #flyleaf-body h3, #flyleaf-body h4 {
  color: var(--fl-strong); font-weight: 600; letter-spacing: -.02em;
  line-height: 1.25; margin: 1.8em 0 .7em;
}
#flyleaf-body b, #flyleaf-body strong { color: var(--fl-strong); }
#flyleaf-body a { color: var(--fl-strong); text-decoration: none; border-bottom: 1px solid var(--fl-border-hi); }
#flyleaf-body hr { border: 0; height: 1px; background: var(--fl-border); margin: 32px 0; }
#flyleaf-body img { max-width: 100%; height: auto; border-radius: 10px; display: block; margin: 1.5em auto; }
#flyleaf-body blockquote {
  border-left: 2px solid var(--fl-border-hi); background: var(--fl-chip);
  border-radius: 0 10px 10px 0; margin: 1.8em 0; padding: 14px 20px; color: var(--fl-muted);
}
#flyleaf-body ::selection { background: var(--fl-strong); color: var(--fl-bg); }

/* progress bar */
#flyleaf-progress {
  position: fixed; top: 0; left: 0; height: 2px; width: 0;
  background: var(--fl-progress); z-index: 2147483646; pointer-events: none;
}

/* floating toggle — quiet until hovered */
#flyleaf-fab {
  position: fixed; right: 16px; bottom: 16px; width: 40px; height: 40px;
  border-radius: 50%; background: #0f0f0f; border: 1px solid #2e2e2e;
  color: #a1a1a1; font: 600 14px/1 -apple-system, system-ui, sans-serif;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: .4; z-index: 2147483647; padding: 0;
  transition: opacity 140ms ease, color 140ms ease;
}
#flyleaf-fab:hover, #flyleaf-fab.fl-open { opacity: 1; color: #ededed; }

/* settings panel — Safari Reader popover structure:
   theme swatches / fonts / size / layout / mode / nav / hide-reader */
#flyleaf-panel {
  position: fixed; right: 16px; bottom: 64px; width: 300px;
  max-width: calc(100vw - 32px); max-height: calc(100vh - 90px); overflow-y: auto;
  background: #0c0c0c; border: 1px solid #2e2e2e; border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,.8); padding: 16px;
  z-index: 2147483647; font-family: -apple-system, system-ui, sans-serif;
  color: #ededed; opacity: 0; transform: translateY(8px) scale(.98);
  pointer-events: none; transition: opacity 160ms ease, transform 160ms ease;
}
#flyleaf-panel.fl-open { opacity: 1; transform: none; pointer-events: auto; }
#flyleaf-panel * { all: revert; box-sizing: border-box; font-family: inherit; }

#flyleaf-panel .fl-label {
  font-size: 11px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: #707070; margin: 14px 0 8px;
}
#flyleaf-panel .fl-label:first-child { margin-top: 0; }

#flyleaf-panel .fl-swatches { display: flex; gap: 10px; }
#flyleaf-panel .fl-swatch {
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  border: 2px solid #2e2e2e; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; transition: border-color 120ms ease;
}
#flyleaf-panel .fl-swatch.fl-active { border-color: #ededed; }

#flyleaf-panel select {
  width: 100%; background: #000; border: 1px solid #1f1f1f; border-radius: 8px;
  color: #d4d4d4; font-size: 13px; padding: 8px 10px;
}

#flyleaf-panel .fl-stepper { display: flex; gap: 4px; align-items: stretch; }
#flyleaf-panel .fl-stepper button {
  flex: 1; background: #000; border: 1px solid #1f1f1f; border-radius: 8px;
  color: #d4d4d4; cursor: pointer; padding: 8px 0; font-size: 13px;
}
#flyleaf-panel .fl-stepper button:hover { border-color: #2e2e2e; color: #ededed; }
#flyleaf-panel .fl-stepper .fl-val {
  flex: 1.2; display: flex; align-items: center; justify-content: center;
  font: 12px ui-monospace, Menlo, monospace; color: #707070;
}

#flyleaf-panel input[type=range] {
  -webkit-appearance: none; appearance: none; width: 100%; height: 3px;
  background: #2e2e2e; border-radius: 999px; outline: none; margin: 6px 0 0;
  padding: 0; cursor: pointer; display: block;
}
#flyleaf-panel input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: #ededed; border: 0; cursor: pointer;
}

#flyleaf-panel .fl-seg { display: flex; gap: 4px; background: #000; border: 1px solid #1f1f1f; border-radius: 8px; padding: 3px; }
#flyleaf-panel .fl-seg button {
  flex: 1; background: transparent; border: 0; border-radius: 6px;
  color: #707070; font-size: 12px; font-weight: 500; padding: 6px 4px; cursor: pointer;
}
#flyleaf-panel .fl-seg button.fl-active { background: #1a1a1a; color: #ededed; }

#flyleaf-panel .fl-row2 { display: flex; gap: 8px; }
#flyleaf-panel .fl-btn {
  flex: 1; background: #000; border: 1px solid #1f1f1f; border-radius: 8px;
  color: #a1a1a1; font-size: 12px; padding: 8px 6px; cursor: pointer;
}
#flyleaf-panel .fl-btn:hover { border-color: #2e2e2e; color: #ededed; }
#flyleaf-panel .fl-nav-status { font-size: 11.5px; color: #707070; margin-top: 6px; line-height: 1.6; white-space: pre-line; word-break: break-all; }

#flyleaf-panel .fl-primary {
  width: 100%; margin-top: 16px; background: #ededed; border: 0; border-radius: 8px;
  color: #000; font-size: 13px; font-weight: 600; padding: 10px 0; cursor: pointer;
}

#flyleaf-panel .fl-hint {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid #1f1f1f;
  font-size: 11px; color: #707070; line-height: 1.7;
}
#flyleaf-panel kbd {
  background: #000; border: 1px solid #2e2e2e; border-radius: 4px;
  padding: 1px 5px; font: 10px ui-monospace, Menlo, monospace; color: #a1a1a1;
}

/* toast */
#flyleaf-toast {
  position: fixed; bottom: 70px; left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: #111; border: 1px solid #2e2e2e; border-radius: 999px;
  color: #ededed; font: 13px -apple-system, system-ui, sans-serif;
  padding: 9px 16px; z-index: 2147483647; opacity: 0; pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease; white-space: nowrap;
}
#flyleaf-toast.fl-show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* element picker highlight */
#flyleaf-pick-box {
  position: fixed; z-index: 2147483647; pointer-events: none;
  border: 2px solid #4da3ff; border-radius: 4px;
  background: rgba(77, 163, 255, 0.15);
}
#flyleaf-pick-tip {
  position: fixed; z-index: 2147483647; left: 50%; top: 18px;
  transform: translateX(-50%);
  background: #111; border: 1px solid #2e2e2e; border-radius: 999px;
  color: #ededed; font: 13px -apple-system, system-ui, sans-serif;
  padding: 9px 18px; pointer-events: none; white-space: nowrap;
}
`;
