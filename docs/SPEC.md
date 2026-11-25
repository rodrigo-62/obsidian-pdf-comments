# PDF Comments — margin comments on PDFs in Obsidian

> Name: **PDF Comments** (plugin id `pdf-comments`, CSS prefix `pdfc`), confirmed.

## 0. Instructions for Claude Code

- This file is the spec. Read it fully before writing code.
- Work in the **phases** in §10, one at a time. At the end of each phase, stop and give me a short summary plus anything I need to test by hand.
- Items marked **DECISION** are the current choice. Where §12 lists one as "confirm with me", ask before building on it. Decisions that fill gaps go in `docs/DECISIONS.md` with a reason.
- Keep the core logic (anchors, sidecar format, export, layout) in **pure TypeScript with no Obsidian imports** (`src/core/`), unit-tested with vitest. Obsidian and PDF.js glue goes in `src/obsidian/`.
- The plugin **writes files in my vault** (the sidecar comment notes, §5). Never test against my real vault. Use the test vault (§11).
- Much of this exists already in my **Docs** plugin (`/home/parrhasius/code/projects/obsidian-docs-plugin`, margin comments for Markdown notes). Reuse it as described in §8. Read its `docs/SPEC.md` and `docs/DECISIONS.md` first: most UX questions were already settled there, and the same answers apply here unless this spec says otherwise.
- I use **NixOS** (§11).

---

## 1. What I want

I read and study PDFs (papers, books, chapters) in Obsidian. I want to comment on them the way the Docs plugin lets me comment on my own notes, i.e. like Google Docs:

1. **A PDF view with a comment margin.** Pages in a column on the left, comment cards in a margin on the right, each card level with the passage it refers to.
2. **Comments on selected text.** Select text, write a comment, and the text is highlighted. Threads with replies, edit, delete, resolve, priority, search: the same as in Docs.
3. **Comments on an area** (a figure, a formula, a scanned page with no text layer): drag a rectangle instead of selecting text.
4. **Copy for LLM.** One command that copies the PDF's text and my comments in a form an AI agent can fully understand, as Docs does for notes.

It must not depend on Obsidian's built-in PDF view working (on NixOS it was blank for a while, see §2.1), and it must not change the PDF file.

## 2. Background

### 2.1 Why the built-in viewer was blank
On nixpkgs, Obsidian runs on the system Electron (40 at the time of writing). Obsidian serves vault files on an `app://` URL, and on Electron ≥ 39 a `fetch`/XHR of that URL from the page fails (status 0). Obsidian's PDF view loads the PDF through that URL, so it showed nothing. Images still work because `<img>` loads are not affected. Running Obsidian on Electron 37 fixes it (done in my NixOS config).

**Consequence for this plugin:** load PDFs by reading the bytes with `app.vault.readBinary(file)` and passing `{ data }` to PDF.js. Never load a PDF through `getResourcePath()` / `app://`. Then the plugin works on any Electron.

### 2.2 What Obsidian already ships
Checked in Obsidian 1.10.3 (installer) / 1.15.1 (app):

- `loadPdfJs()` is public API and returns `window.pdfjsLib` (PDF.js **5.3.34**). Its worker is already configured (`GlobalWorkerOptions.workerSrc = /lib/pdfjs/pdf.worker.min.mjs`).
- `window.pdfjsViewer` (not documented) has the standard PDF.js viewer components: `PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`, `PDFPageView`, `PDFRenderingQueue`, `PDFThumbnailViewer`, plus Obsidian's own `createObsidianPDFViewer` and `ObsidianServices`. **It is not loaded by `loadPdfJs()`**, only when Obsidian's PDF view first opens (from `/lib/pdfjs/pdf.viewer.min.mjs`); the plugin loads that file itself (DECISIONS D0.1).
- A spike confirmed that a plugin can build its own viewer from these: `new PDFViewer({ container, viewer, eventBus, linkService, findController, textLayerMode: 1 })`, fed with `getDocument({ data })`, renders the canvas and a selectable text layer, also on Electron 40 with no built-in view opened. Details in `docs/RESEARCH.md`.

### 2.3 Prior art (study in Phase 0)

| Project | Relevance |
|---|---|
| **PDF++** (RyotaUshio/obsidian-pdf-plus) | Extends the built-in PDF view: highlights from links in notes (`[[file.pdf#page=3&selection=…]]`), optional PDF annotations written with pdf-lib. Look at how it hooks into the built-in view, how it maps selections to `selection=` links, and what breaks across Obsidian updates. |
| **Annotator** (elias-sundqvist/obsidian-annotator) | **Actively maintained** (0.3.x rewrite, Nov 2026). Highlights, notes with replies, areas, drawing, in a sidebar beside Obsidian's built-in PDF view; one Markdown annotation note per source. No margin layout, resolve, priority or LLM export. See `docs/RESEARCH.md` §4. |
| **Hypothes.is / W3C Web Annotation** | `TextQuoteSelector` (exact + prefix + suffix) and `TextPositionSelector` (start/end). The standard way to anchor robustly to text that may shift. |
| **Zotero reader** | Highlight + comment + area ("image") annotations on PDFs, stored outside the PDF, exportable into it. The UX to match for area comments. |
| **Docs** (my plugin) | Margin layout, cards, threads, Copy for LLM. §8. |

## 3. The viewer

### 3.1 A view of our own
**DECISION: our own `ItemView` (view type `pdf-comments`) built from `pdfjsViewer.PDFViewer`, not a patch of Obsidian's built-in PDF view.**
- Pros: we own the layout (page column + margin in one scroll container), we don't depend on the internals of Obsidian's view (which change between versions), and loading bytes ourselves avoids §2.1.
- Cons: we must re-provide what the built-in view gives: zoom, find, outline, page navigation, links inside the PDF, `#page=` subpaths.
- Alternative (PDF++'s route): inject the margin into the built-in view. Rejected as the default because it depends on undocumented internals, but Phase 0 should check how PDF++ does it in case it is simpler than it looks.
- Fallback if `window.pdfjsViewer` disappears in a future Obsidian: bundle `pdfjs-dist`'s viewer components at the **same version** as `pdfjsLib.version` (lib and viewer must match). Check the version at load and show a clear notice on mismatch.

### 3.2 Opening PDFs
- Command **"Open PDF with comments"** and a file-menu entry on PDFs.
- Setting **"Open PDFs with comments by default"** (default on). When on, a PDF opened anywhere (file explorer, link, quick switcher) opens in our view. A header button switches to Obsidian's built-in view, and back.
- Links: `[[paper.pdf#page=12]]` opens at page 12. Support Obsidian's own `#page=N&selection=a,b,c,d` subpath (start item index, start offset, end item index, end offset; verified in Phase 0, DECISIONS D0.5) so links made in the built-in view still work. Our own parameter `&comment=k3f9` opens the thread.
- Embeds (`![[paper.pdf#page=3]]`) stay with Obsidian's core embed. Non-goal for v1.

### 3.3 Viewer features (v1)
- Continuous vertical scroll, lazy page rendering (PDFViewer does this).
- Zoom: fit width (default), fit page, 50–400 %, Ctrl+scroll, commands for zoom in / out / reset. **Fit width means the pane width minus the margin**, so the margin is always visible.
- Page navigation: page number box ("12 / 340"), commands for next / previous page, Home / End.
- Find: Ctrl+F opens a find bar backed by `PDFFindController` (match case, whole word, next / previous, match count).
- Outline (table of contents) from `doc.getOutline()` in a dropdown or the right sidebar. Thumbnails: later.
- Links inside the PDF (internal destinations and external URLs) via `PDFLinkService`. External URLs open in the browser.
- Remember the scroll position and zoom per file (in plugin data, keyed by path; follow renames).
- **Page colours:** normal, sepia or dark, for all PDFs at once (toolbar, setting, commands). Only the rendered pages are recoloured (DECISIONS D3.1).
- Password-protected PDFs: prompt for the password (PDF.js `onPassword`).

## 4. Comments: UX

The same as Docs (its SPEC §5.1, §5.5 and DECISIONS) unless stated here:

- **Create from text:** select text in the text layer, then hotkey (suggest Ctrl+Alt+M), context menu, or toolbar button. A card opens in the margin with a focused composer. Ctrl+Enter saves, Esc cancels; an empty cancelled comment leaves nothing.
- **Create from an area:** a toolbar toggle (or holding Alt while dragging) draws a rectangle on a page. Used for figures, formulas and scanned pages. The card shows a small cropped image of the area instead of a quote.
- **Selections may span pages.** A paragraph that continues on the next page is one anchor with two segments (§5.2).
- **Highlights** are drawn by the plugin in an overlay layer per page (not in the text layer), so they show even before the text layer exists and on pages without text. The active thread's highlight is stronger; overlaps are darker; resolved threads have no highlight unless *Show resolved* is on.
- **Margin cards** are level with the top of their anchor, laid out with Docs' `layoutCards` (active card gets its ideal position; the others are pushed up / down).
- **Click** a highlight to activate its card; click a card to scroll to and flash its highlight.
- **Threads:** replies (to the thread or to any comment), "↳ re:" chips, tree view, edit, delete, resolve / re-open, priority, Markdown bodies with `---` separators, comment search, next / previous comment. All as in Docs.
- **Detached comments:** if an anchor can't be found any more (the PDF file was replaced by a different version, §5.3), the thread goes under "Detached comments" at the bottom of the margin, showing its quote and page.
- **Narrow pane:** below a width threshold, cards move to a comments sidebar (`ItemView`), as in Docs.
- **Copy link to comment:** `[[paper.pdf#page=12&comment=k3f9]]`, to paste into my notes.
- **Copy link to selection:** right-click a selection, as in Obsidian's own viewer (Obsidian's link format; DECISIONS D3.7).

## 5. Storage

A PDF can't hold `<!--c:ID-->` markers, so comments live **outside** the PDF.

### 5.1 Where
**DECISION (confirmed by me): one Markdown note per PDF, all in one folder**, default `PDF comments/` (a setting). `Papers/Smith 2021.pdf` → `PDF comments/Smith 2021.md`.
- It's a normal note, so it syncs (Obsidian Sync, git), and agents and backups see it. It is not in a dot-folder (Obsidian Sync skips those). PDF folders stay clean.
- **The frontmatter link is what ties a note to its PDF**, not the file name: `commented-pdf: "[[Papers/Smith 2021.pdf]]"`. Obsidian updates that link when the PDF is renamed or moved, so the pairing survives without the plugin. Look a PDF's note up through `metadataCache` (an index from PDF path to note, rebuilt on `metadataCache` changes), never by guessing the name.
- Name collisions (two `Smith 2021.pdf` in different folders): the second note gets the PDF's parent folder in its name, `Smith 2021 (Papers-old).md`, then a number if still taken.
- When a PDF is renamed, the plugin renames its note to match (`vault.on('rename')`, via `app.fileManager.renameFile` so links to the note are updated). A setting can turn that off.
- When a PDF is deleted, its note is kept (it may hold work); the threads show as detached if the PDF comes back changed.
- Alternatives considered:
  - **A note next to each PDF** (`Smith 2021.pdf.comments.md`). Simplest pairing, but clutters PDF folders. Rejected by me.
  - **Inside the PDF as standard annotations** (`/Text` + `/Highlight` with `/IRT` replies). Other readers (Okular, Zotero, Acrobat) would show them. But it rewrites PDF files (risk of corruption, large diffs, sync conflicts), and priority / tree replies / resolved need custom keys. Better as a later **"Export comments into a copy of the PDF"** command.
  - **Plugin data (`data.json`).** Not portable, invisible to agents, one big file. Rejected.
  - **A `.json` sidecar.** Obsidian doesn't index it or update links in it. Rejected in favour of `.md`.

### 5.2 Format
The thread JSON uses the Docs format (its `Thread` / `Comment` types, so `core/model.ts` is reused unchanged) plus an `anchor` per thread. Same block syntax as Docs, at the end of the note:

````
---
commented-pdf: "[[Papers/Smith 2021.pdf]]"
commented-pdf-fingerprint: "a1b2c3…"
---
(generated digest, see below)

<!--pdf-comments:threads
{
  "k3f9": {
    "anchor": {
      "segments": [
        { "page": 12, "start": 1834, "end": 1990, "rects": [[72.1, 540.2, 523.8, 552.0], [72.1, 526.0, 310.4, 537.8]] },
        { "page": 13, "start": 0, "end": 41, "rects": [[72.1, 700.3, 290.0, 712.1]] }
      ],
      "prefix": "…the 32 characters before",
      "suffix": "the 32 characters after…"
    },
    "quote": "the exact selected text",
    "created": "2026-11-25T15:41:00Z",
    "resolved": false,
    "comments": [
      { "id": "a1", "parent": null, "created": "2026-11-25T15:41:00Z", "body": "…" }
    ]
  },
  "p2xm": {
    "anchor": { "segments": [ { "page": 4, "rects": [[100, 300, 480, 620]] } ], "area": true },
    "quote": "",
    "created": "…", "resolved": false, "comments": [ … ]
  }
}
-->
````

- `page` is 1-based. `rects` are in **PDF user-space units** of that page (`[x1, y1, x2, y2]`, origin bottom-left, as in PDF), so they don't depend on zoom. Highlights and card positions are computed from them.
- `start` / `end` are offsets into that page's **normalised text** (§5.3). `quote` + `prefix` + `suffix` form a text-quote selector, as in Hypothes.is.
- Area anchors have `area: true`, rects only, and an empty quote.
- `pdf-fingerprint` is a hash of the PDF file when the sidecar was last written (DECISIONS D3.3).
- Escaping of `-->` in bodies, pretty-printed JSON, unknown keys preserved: exactly as Docs' `threadStore`.
- **Digest (confirmed by me):** above the block, a generated Markdown digest so the note is readable in Obsidian and shows up in search. The JSON stays authoritative; the digest is rewritten from it on every save, and never parsed.
  - A first line: `> Generated from the comments on [[Papers/Smith 2021.pdf]]. Edits here are overwritten; comment in the PDF view.`
  - One `## Page 12` heading per page with comments, in page order; under it, per thread: the quote as a blockquote (or `[area]`), a link that opens the thread (`[[Papers/Smith 2021.pdf#page=12&comment=k3f9|open]]`), then the comments as a list with dates, replies indented, status and priority shown. Resolved threads at the end of each page, marked *(resolved)*. Detached threads under `## Detached`.
  - It is a pure function of the threads (`digest.ts`), unit-tested, so it is stable and diffs stay small.
  - If I edit the digest anyway, the edit is lost on the next save. The view shows a notice the first time it overwrites a digest that differs from what it generated.
- Keep storage behind a `CommentStore`-like interface so the location or format can change.

### 5.3 Anchoring
- **Page text** = PDF.js `getTextContent()` items joined in order, with `"\n"` where an item has `hasEOL`, Unicode-normalised (NFKC, which PDF.js also offers). One pure function produces it, and every offset refers to it. Unit-test it.
- **From a DOM selection to an anchor:** map the selection's start / end text-layer spans back to item index + offset, then to page-text offsets. Rects come from `Range.getClientRects()`, converted to PDF units with the page viewport (`viewport.convertToPdfPoint`), merged per line.
- **Re-anchoring on open:** if the fingerprint matches, trust `page` / `start` / `end` / `rects`. If not (the PDF was replaced, e.g. a new version of a paper), search for `quote` (with prefix / suffix to disambiguate, nearest to the old page first) and recompute offsets and rects; if not found, the thread is **detached**. Area anchors on a changed PDF stay where they were but get a "PDF changed" warning.
- Writes: the sidecar is written with `app.vault.process` (never `modify` on stale content), debounced, and created on the first comment. A PDF without comments has no sidecar.

## 6. Copy for LLM

Same idea and the same notation as Docs (milestone markers `⟦cN⟧…⟦/cN⟧`, `<notation>`, `<comments>` with `reply-to`, dates, status, priority), adapted to PDFs:

- PDFs can be long, so the command opens a small modal with a **scope**:
  - **Comments with context** (default): only the commented passages, each with its page number and the surrounding paragraph, plus the threads.
  - **Pages with comments:** the full text of every page that has a comment.
  - **Page range** (e.g. 10–24).
  - **Whole document.**
  - Plus Docs' options: include resolved threads, comments only, current selection only.
- Text goes in `<page n="12">…</page>` blocks with the markers inserted at the anchor offsets. A comment spanning pages has its opening marker on one page and its closing marker on the next.
- Area comments: `⟦c3: area on page 4⟧` in the text where the area is (by vertical position), and in the thread `anchor="[area on page 4]"`.
- The header says what was left out: `<document title="Smith 2021" source="Papers/Smith 2021.pdf" pages="340" scope="comments with context">`.
- Text extraction is imperfect (columns, hyphenation, headers and footers). The notation says so, and joins words hyphenated across a line break.
- Pure function `exportPdfForLLM(pages: PageText[], threads, options)`, with tests. Reuse Docs' thread rendering (§8).
- Notice after copying, e.g. "Copied: 12 threads, 9 pages (2 resolved omitted)".

## 7. Architecture

```
src/
  core/                    # pure TS, no 'obsidian' or pdf.js import, unit-tested
    shared/                # copied from Docs (§8): model.ts, layout.ts, search.ts, textFormat.ts (threadRender.ts in Phase 4)
    pageText.ts            # text items -> page text, item/offset <-> page offset
    anchor.ts              # Anchor types and validation, rects (merge, CSS <-> PDF, from item geometry), order, context
    quote.ts               # normalised quote search (re-anchoring of one anchor)
    reanchor.ts            # re-anchoring all threads of a note against a changed PDF
    sidecar.ts             # parse/serialise the sidecar note (frontmatter + thread block)
    digest.ts              # threads -> readable Markdown digest
    sidecarName.ts         # PDF path -> note path in the comments folder, collisions
    export.ts              # exportPdfForLLM()
  obsidian/
    main.ts                # Plugin: commands, settings, open-by-default, rename handling
    pdfView.ts             # ItemView: PDFViewer, toolbar, find, outline, state
    pdfjs.ts               # access to pdfjsLib / pdfjsViewer, version check, fallback
    selection.ts           # DOM selection / area drag -> Anchor
    highlights.ts          # per-page overlay layer
    margin/                # margin layer and cards (adapted from Docs)
    sidebarView.ts         # comments sidebar (adapted from Docs)
    store.ts               # sidecar read/write through the vault
styles/
tests/
```

- Start from the Docs repo's setup (flake, esbuild, tsconfig, eslint with `eslint-plugin-obsidianmd`, vitest + happy-dom), not from scratch.
- No UI framework. Plain DOM with Obsidian's `createEl` helpers, as in Docs.
- Clean up on `onunload`: views, listeners, the open-by-default hook.
- `isDesktopOnly: true` for v1.

## 8. Reuse from Docs

**DECISION: copy the reusable modules into `src/core/shared/` and `src/obsidian/` with a header line naming their source file and the Docs commit (`13957fe`, v1.2.0).** A shared npm package or submodule would avoid drift but adds tooling for two plugins. Revisit if both keep changing the same code.

| Docs module | Here |
|---|---|
| `core/model.ts` (Thread, Comment, replies, tree view, priority, resolve) | as is |
| `core/layout.ts` (`layoutCards`) | as is |
| `core/search.ts` (`matchingComments`, `findOccurrences`) | as is |
| `core/textFormat.ts` (Ctrl+B/I/K in the composer) | as is |
| `core/threadStore.ts` (block parse/serialise, escaping) | adapted: block name `pdf-comments:threads`, plus frontmatter |
| `core/export.ts` | split: the thread / notation rendering becomes `threadRender.ts`; the Markdown-specific part stays in Docs |
| `obsidian/margin/card.ts`, `composer.ts`, `menus.ts` | adapted: anchors are PDF anchors instead of CodeMirror ranges |
| `obsidian/margin/marginView.ts` | adapted: positions come from page offsets + rects × scale, not `coordsAtPos` |
| `obsidian/sidebarView.ts` | adapted |
| `styles/comments.css`, `margin.css`, priority colours | mostly as is |

Not reused: markers, CodeMirror integration, page view / themes, footnotes, reading view.

## 9. Non-goals (v1)

- Changing the PDF file in any way (annotations, form filling, ink, signatures).
- Reading or showing annotations that are already inside the PDF beyond what PDF.js renders by default.
- ~~Highlights without a comment~~: added after Phase 5 (DECISIONS H1).
- EPUB and other formats. Embeds. Mobile. Multi-user or sync logic.
- OCR for scanned PDFs (area comments cover them).

## 10. Phases

Each phase ends with `npm test` and `npm run build` passing, a short report, and manual checks added to `docs/TESTING.md`.

0. **Setup and research.** Repo setup (§11), test vault with sample PDFs, headless harness. Study PDF++ and Annotator (§2.3). Verify Obsidian's `#page=&selection=` format, and whether `window.pdfjsViewer` is available before any PDF has been opened (or only after `loadPdfJs()`). Spike the selection → text-offset mapping. Report, and **stop and ask me** only if something changes §3.1 or §5 (§12).
1. **Viewer.** Our view with everything in §3: open-by-default with switch-back, zoom, page navigation, find, outline, internal links, subpaths, state per file, dark toggle, password prompt. *Done when* it can replace the built-in view for daily reading, including on Electron 40 (where the built-in view is blank).
2. **Anchor and storage core.** `pageText.ts`, `anchor.ts`, `sidecar.ts`, `digest.ts`, `sidecarName.ts`, with tests: offsets ↔ items, multi-page anchors, rect conversion and merging, quote search and re-anchoring, sidecar round-trip, escaping, unknown keys kept, digest output, name collisions.
3. **Comments UI.** Selection → comment, highlight overlay, margin cards (copied and adapted from Docs), replies, edit, delete, resolve, priority, detached comments, sidebar fallback, comment search, next / previous comment. Sidecar notes in the comments folder with the digest, PDF → note index, note rename when the PDF is renamed.
4. **Copy for LLM.** `export.ts` with tests, the modal, the command.
5. **Area comments and polish.** Area anchors with image crops, copy link to comment + `#comment=` subpath, settings tab, README.

## 11. Dev environment (NixOS)

- Node from a flake `devShell` with `nodejs_22`, copied from Docs.
- Obsidian from nixpkgs, on Electron 37 (my system config). The plugin must also work on the unmodified package (Electron 40); check both in the headless harness.
- **Headless harness:** copy Docs' `scripts/obsidian-headless.sh` and `scripts/cdp.mjs` (Xvfb, isolated profile, a copy of the test vault, remote debugging). Use a different debugging port from Docs' (9333) so both can run. Use it to look at the UI before telling me something works.
- **Test vault** `test-vault/` with generated sample PDFs (a script, not binaries from the internet): a multi-page text PDF, a two-column paper-like PDF, a page with an image and no text, a long PDF (~300 pages) for performance, a PDF with an outline and internal links, a password-protected one. Plus sidecars with comments, including one whose PDF was replaced (detached threads).
- `npm run dev` builds into `test-vault/.obsidian/plugins/pdf-comments/` with Hot Reload, as in Docs.
- Never touch my real vaults or `~/.config/obsidian`.

## 12. Open questions

**Answered (2026-11-25):**
1. Storage: one note per PDF, all in one folder (§5.1).
2. PDFs open in this view by default, with a button to switch back (§3.2).
3. The note gets a readable, generated digest (§5.2).

**Confirm with me:**
4. The name (before the first release).
5. Anything Phase 0 finds that changes §3.1 (own view vs patching the built-in one) or §5 (storage).

**Check early:**
- Mapping text-layer selections to text-item offsets in PDF.js 5 (span structure, `hasEOL`, marked content). Spike this in Phase 0.
- Margin layout performance with ~200 threads in a 300-page PDF while scrolling and zooming (only lay out cards near the viewport if needed).
- Coordinates under zoom and HiDPI: rects in PDF units → CSS pixels via the page viewport, re-computed on `scalechanging`.
- How `PDFViewer` behaves in an Obsidian pane that is hidden, resized, or moved to a popout window (popouts have their own `window`; check `activeWindow` / `activeDocument` usage).
- `window.pdfjsViewer` is undocumented: how stable has it been across Obsidian versions? (PDF++ history will tell.)
