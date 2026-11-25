# Decisions

Decisions that fill gaps in, or deviate from, `docs/SPEC.md`. Newest last. Evidence for Phase 0 decisions is in `docs/RESEARCH.md`.

## Phase 0

**D0.1 — How the plugin gets the PDF.js viewer.** `loadPdfJs()` only loads `pdfjsLib`; `pdfjsViewer` exists only after Obsidian's own PDF view has opened. The plugin loads Obsidian's own viewer build (`/lib/pdfjs/pdf.viewer.min.mjs`, a module script) when `window.pdfjsViewer` is missing, once, and waits for it. Reason: it matches Obsidian's `pdfjsLib` exactly and gives the `data-idx` text layer that Obsidian's selection links use; tested on Electron 40 with no built-in view opened. Bundling `pdfjs-dist` stays the fallback if that path ever disappears (check at load: missing `PDFViewer`, or `pdfjsLib.version` other than the one tested → clear notice).

**D0.2 — Page text and offsets.** Page text = `getTextContent()` items (default options) joined in order, with `"\n"` after each `hasEOL` item. Anchors store offsets into it. A DOM selection maps to (item index from `data-idx`, char offset), then to page-text offsets. Unicode normalisation is applied only for searching quotes (re-anchoring), never to the stored offsets, so offsets always match `data-idx` positions.

**D0.3 — Test PDFs are generated with Typst, protected copy with qpdf.** Both are in the flake dev shell. Reason: real text, outline, footnotes, internal and external links, two columns, a figure, a ~300-page book, and a "revised" version with shifted text, from small sources in git; no binaries from the internet. Generated PDFs are git-ignored.

**D0.4 — Harness port 9335.** Docs uses 9333; both harnesses can run at once. `OBSIDIAN_ELECTRON` runs the harness on another Electron (e.g. 40) to check the plugin where the built-in view is blank.

**D0.5 — Obsidian-compatible links.** `#page=N&selection=a,b,c,d` (item index, offset, item index, offset; verified in 1.15.1) opens in our view with that text flashed; "copy link to comment" writes `#page=N&selection=…&comment=ID` so the link also works in the built-in view (it ignores `comment`). Obsidian 1.8.0's off-by-one is ignored (minAppVersion can move past it if needed).

## Phase 1 (viewer)

**D1.1 — Obsidian's PDF classes for the look.** Our scroll container has `.pdf-viewer-container` inside a `.pdf-container`, pages in `.pdfViewer`, so pages, page gaps, text selection colour, find highlights and link hover look exactly like Obsidian's viewer and follow its theme variables. Our own additions use the `pdfc-` prefix.

**D1.2 — Same document options as Obsidian.** `getDocument` gets Obsidian's `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl` (all under `/lib/pdfjs/`), `isEvalSupported: false`, `enableXfa: true`; the viewer gets `imageResourcesPath`, `enableHWA`, `maxCanvasPixels` as Obsidian sets them (read from its `AppOptions` in 1.15.1). Without the cMaps and standard fonts, some PDFs would render with wrong glyphs.

**D1.3 — Types from `pdfjs-dist` 5.3.31.** Obsidian ships PDF.js 5.3.34, which is not on npm (its own build). The nearest published version is used for type-checking only; nothing from it is bundled.

**D1.4 — Open-by-default by patching `WorkspaceLeaf.setViewState`** (with `monkey-around`, the technique the Kanban plugin uses for Markdown): a request for Obsidian's `pdf` view becomes ours, so every way of opening a PDF (explorer, links, quick switcher, restored tabs, deferred tabs when shown) is covered. A tab switched to Obsidian's viewer with the header button stays there for the session, also when it navigates to another PDF. Obsidian's PDF views get an "Open with comments" header button.

**D1.5 — Loading is not awaited in `onLoadFile`.** Otherwise a password prompt blocks Obsidian's `openFile()` until it is answered. Links that arrive while the PDF loads wait in `pendingSubpath`. A cancelled prompt shows "This PDF is protected by a password" with an *Enter password* button.

**D1.6 — Disabling the plugin hands tabs back to Obsidian's viewer**, at the same page, instead of leaving empty tabs. Obsidian runs a plugin's registered cleanups before `onunload()` and empties the tabs of an unregistered view type some time later, so the hand-back is a cleanup registered before the view, and each tab is reopened once Obsidian has emptied it (at most 1 s later). Deferred (not yet loaded) background tabs are found through `leaf.getViewState()`, not `leaf.view`.

**D1.7 — The comment margin is reserved only when it is shown.** SPEC §3.3 says fit width leaves room for the margin "so the margin is always visible". Until a PDF has comments there is nothing in the margin, and an empty 320 px strip looks like a layout bug, so `setMarginVisible()` exists but pages use the full width while there are no comments (as in Google Docs). Phase 3 turns the margin on when a PDF has threads or a comment is being written.

**D1.8 — Zoom.** Presets 50–400 % (zoom in/out step through them); Ctrl+wheel and pinch zoom smoothly around the pointer, about 10 % per mouse notch, between 25 and 500 %. Fit width and fit page are computed by us (pane minus margin) with PDF.js's own paddings, and recomputed when the pane resizes.

**D1.9 — Position per PDF in plugin data.** Page, top-left point and zoom, keyed by path, at most 300 PDFs (least recently used dropped), following renames and deletes. A PDF changed on disk is reloaded at the same position.

**Known, not fixed:** PDF.js logs `#injectLinkAnnotations: … render method must be called before …` when pages are scrolled past while rendering (its link auto-detection; Obsidian's viewer has the same setting and the same message). Popout windows are untested. Thumbnails are not in v1.

## Phase 2 (anchor and storage core)

**D2.1 — Shared code is copied from Docs** into `src/core/shared/` (`model.ts`, `layout.ts`, `textFormat.ts` unchanged; `search.ts` with only the two helpers that don't need Markdown markers), each with a header naming the Docs file and commit `13957fe`, plus Docs' tests for them in `tests/shared/`. Docs' `threadStore.ts` was adapted into `sidecar.ts` (same JSON layout, escaping and "unknown fields are kept" rule) rather than copied, because the comment note is generated as a whole and has no inline markers.

**D2.2 — Re-anchoring ignores whitespace altogether.** Typst (and other producers) drop the hyphen of a word split at a line or page end ("The improve" / "ment was real"), so a quote and its re-laid-out text differ in where line breaks fall, not just in how many. The normalised form leaves out all whitespace (also drops line-end hyphens between letters and soft hyphens, unfolds ligatures with NFKC, folds typographic quotes and dashes). Repeated passages ("Lorem ipsum…" occurs twice) are told apart by up to 32 characters of prefix and suffix, then by the page nearest to the old one. Exact matches first; case is ignored only if there is none. No fuzzy matching in v1: a quote whose words changed becomes detached.

**D2.3 — Cross-page anchors are re-found part by part if needed.** A selection across a page break includes whatever the PDF has in between (footnotes, page numbers), so the whole quote is tried first, and if it isn't found, each page's part is found in order. The parts are cut from the quote using the stored offsets (the quote is always the segments' texts joined by a line break, so their lengths add up). A part that itself contains page furniture can still fail after a re-layout; such threads become detached.

**D2.4 — Rectangles after re-anchoring come from text-item geometry** (`rectsFromItems`: equal-width characters within an item, 0.2 of the font height below the baseline to 0.8 above). Rectangles of new comments come from the DOM selection (Phase 3), which is exact. Rectangles are stored rounded to 0.1 PDF unit.

**D2.5 — The comment note is written as a whole.** `buildSidecar` keeps every property line except `pdf` and `pdf-fingerprint` (and lines indented under them) exactly as written, then writes the digest and the block. This is one atomic `vault.process` in Phase 3 instead of `processFrontMatter` plus a body write. Values are written as JSON strings, which are valid YAML double-quoted scalars.

**D2.6 — Digest dates are UTC**, like Docs' export, so the digest is the same on every machine and an unchanged digest is recognised as unchanged (the "you edited the digest" notice must not fire because of a time zone).

**D2.7 — `detached` is stored.** When re-anchoring can't find a quote, the thread keeps its old anchor and gets `"detached": true`, so the digest lists it under "Detached" and the next re-anchoring can bring it back (which clears the mark). Area anchors on a changed PDF get `"pdfChanged": true` on the anchor.

**D2.8 — Fixtures from real PDF.js output.** `scripts/extract-text-fixture.mjs` writes the text items of three test PDFs to `tests/fixtures/*.json` (committed, ~200 kB) using `pdfjs-dist` 5.3.31 in Node. The test of Obsidian's `selection=5,2,11,5` against these items gives exactly the text Obsidian's own viewer selected, so the Node items match Obsidian's.
