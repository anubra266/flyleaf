/* Flyleaf — all injected CSS, kept out of the page until reader UI exists.
   Everything is scoped under #flyleaf-* ids; the reader surface resets
   inherited site styles with `all: revert` and re-styles from there.

   Root scrolling on purpose: the reader is an in-flow block and the
   DOCUMENT scrolls — the browser's fastest, always-threaded scroll path.
   No backdrop-filter anywhere: a blur over scrolling content re-blurs
   every frame and is the classic sticky-header jank. */

const css = String.raw
const FLYLEAF_CSS = css`
:root.flyleaf-on { background: var(--fl-backdrop) !important; }
:root.flyleaf-on body { display: none !important; }

#flyleaf-reader {
  display: block;
  min-height: 100vh;
  background: var(--fl-backdrop);
  color: var(--fl-text);
  font-family: var(--fl-font);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  /* Safari's exact geometry: a thin backdrop strip above the paper
     (~8px) and ~45px side margins; the paper runs off the bottom. */
  /* symmetric breathing: vertical margin top and bottom, wider sides */
  padding: 28px 24px;
}
#flyleaf-reader * { all: revert; box-sizing: border-box; font-family: inherit; }

/* NOTE: the sheet rules must come AFTER the all:revert line — same
   specificity (ID vs ID+universal), so source order decides. */
/* the paper, exactly as Safari draws it: FLAT. No rounding, no ring,
   no shadow — just the tone difference between backdrop and sheet,
   full height, side margins only. */
#flyleaf-sheet {
  /* the paper is a card sized to the reading column and CENTERED on the
     backdrop; its width scales with zoom (capped to the window) so the
     whole sheet grows as you zoom in, like Safari. */
  background: var(--fl-bg);
  max-width: calc(760px * var(--fl-zoom, 1));
  margin: 0 auto;
  min-height: calc(100vh - 56px);
}
@media (max-width: 700px) {
  #flyleaf-reader { padding: 14px 12px; }
  #flyleaf-sheet { min-height: calc(100vh - 28px); max-width: 100%; }
}

#flyleaf-page {
  /* Safari-style: a fixed reading column, centered on the paper. Zoom
     scales the text (calc below) so the column holds fewer words per
     line as you zoom in — layout stays put, only text grows. */
  /* BOTH the column width and the text scale with zoom (like Safari),
     so the column widens as you zoom in. width stays auto, so it only
     grows up to the sheet — never forces horizontal scroll. */
  max-width: calc(720px * var(--fl-zoom, 1));
  margin: 0 auto;
  padding: 8px 24px 88px;
  font-size: calc(19px * var(--fl-zoom, 1));
  line-height: var(--fl-lh);
  letter-spacing: 0.003em;
}

/* header: borderless 2x2 —  domain | title  /  chapter | prev-next */
#flyleaf-reader #flyleaf-head {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  grid-template-areas: "site title" "chapter nav";
  align-items: center;
  gap: 14px 28px;
  margin: 0 0 2.2em;
}
#flyleaf-reader .fl-cell {
  display: flex; align-items: center; min-width: 0;
  padding: 0; text-decoration: none; color: inherit;
}
#flyleaf-reader .fl-c-site { grid-area: site; }
#flyleaf-reader .fl-c-title { grid-area: title; justify-content: flex-end; }
#flyleaf-reader .fl-c-chapter { grid-area: chapter; }
#flyleaf-reader .fl-c-nav { grid-area: nav; justify-content: flex-end; }

#flyleaf-reader .fl-cell-value {
  font-size: .7em; font-weight: 600; letter-spacing: .04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#flyleaf-reader .fl-c-site .fl-cell-value {
  text-transform: uppercase; color: var(--fl-dim); transition: color 120ms ease;
}
#flyleaf-reader a.fl-c-site:hover .fl-cell-value { color: var(--fl-strong); }
#flyleaf-reader .fl-c-chapter .fl-cell-value { color: var(--fl-muted); }

#flyleaf-reader .fl-c-title .fl-title {
  font-size: .7em; font-weight: 600; letter-spacing: .04em; line-height: 1.4;
  color: var(--fl-strong); margin: 0; text-align: right;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* header nav is quiet text, matching the metadata — not a button */
#flyleaf-reader .fl-c-nav .fl-nav { margin: 0; gap: 20px; justify-content: flex-end; }
#flyleaf-reader .fl-c-nav .fl-pill {
  background: transparent; border: 0; border-radius: 0; padding: 0;
  font-size: .7em; font-weight: 600; letter-spacing: .05em;
  text-transform: uppercase; color: var(--fl-muted);
  transition: color 120ms ease;
}
#flyleaf-reader .fl-c-nav a.fl-pill:hover { color: var(--fl-strong); }
#flyleaf-reader .fl-c-nav span.fl-pill { color: var(--fl-dim); opacity: .5; }

@media (max-width: 640px) {
  #flyleaf-reader #flyleaf-head {
    grid-template-columns: 1fr;
    grid-template-areas: "site nav" "title title" "chapter chapter";
    gap: 10px 16px;
  }
  #flyleaf-reader .fl-c-title { justify-content: flex-start; }
  #flyleaf-reader .fl-c-title .fl-title { text-align: left; }
}
#flyleaf-reader .fl-title {
  font-size: 2em; font-weight: 700;
  letter-spacing: -.03em; line-height: 1.15; color: var(--fl-strong);
  margin: 0 0 1.3em;
}

#flyleaf-reader .fl-nav {
  display: flex; gap: 10px; justify-content: center; margin: 28px 0;
}
#flyleaf-reader .fl-pill {
  display: inline-flex; align-items: center;
  font-size: .72em; font-weight: 500;
  background: var(--fl-chip); border: 1px solid var(--fl-border);
  border-radius: 999px; color: var(--fl-muted); padding: 7px 16px;
  text-decoration: none; cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
#flyleaf-reader a.fl-pill:hover { border-color: var(--fl-border-hi); color: var(--fl-strong); }
#flyleaf-reader span.fl-pill { opacity: .35; cursor: default; }

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
