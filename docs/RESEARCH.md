# Phase 0 research (2026-11-25)

Checked in Obsidian app 1.15.1 (installer 1.10.3), PDF.js 5.3.34, in the headless harness, on Electron 37 and 40.

## 1. PDF.js inside Obsidian

- `loadPdfJs()` (public API) loads **only** `window.pdfjsLib` (`/lib/pdfjs/pdf.min.mjs`). It does **not** load the viewer components.
- `window.pdfjsViewer` appears only when Obsidian's own PDF view opens: Obsidian then adds `<script type="module" src="/lib/pdfjs/pdf.viewer.min.mjs">`.
- A plugin can load that same file itself after `loadPdfJs()` (a module script with `src="/lib/pdfjs/pdf.viewer.min.mjs"`; `app://obsidian.md/…` URLs are not affected by the Electron ≥ 39 bug, which only hits vault-file URLs). Tested on **Electron 40 with no built-in PDF view ever opened**: `PDFViewer` + `EventBus` + `PDFLinkService` + `PDFFindController` render the PDF from `vault.readBinary` bytes, with text layer, outline (`getOutline`) and find (3 matches for "lighthouse").
- Because this is Obsidian's own viewer build, it matches its `pdfjsLib` exactly and includes Obsidian's text-layer additions (`data-idx`, below). The page CSS (`.pdfViewer`, `.page`, `.textLayer`) is already in Obsidian's app CSS.
- Obsidian's build also defines `createObsidianPDFViewer`, `ObsidianServices`, `PDFViewerApplication`. We don't use them (they are the built-in view's internals; PDF++ documents that they changed shape in 1.8.0).

## 2. Text layer and Obsidian's selection links

- Text-layer spans have class `textLayerNode` and `data-idx` = the index of the item in `page.getTextContent().items` (default options; empty `hasEOL` items count but have no span). Tagged PDFs wrap them in `span.markedContent`.
- Obsidian's "copy link to selection" gives `#page=N&selection=beginIdx,beginOffset,endIdx,endOffset` with those indices and character offsets inside the item's string. Verified: selecting from item 5 offset 2 to item 11 offset 5 gives `selection=5,2,11,5`. (In Obsidian 1.8.0 only, indices were off by one: PDF++ has `textDivFirstIdx = apiVersion === '1.8.0' ? 1 : 0`.)
- Other subpaths Obsidian / PDF++ use: `#page=N`, `#page=N&annotation=<id>`, and PDF++'s own `offset=`, `rect=`.
- So: **page text** = items joined, `"\n"` after `hasEOL` items; a DOM selection maps to (item index, offset) through `data-idx`, then to page-text offsets. Both directions are simple and can be unit-tested with plain arrays of items.

## 3. PDF++ (RyotaUshio/obsidian-pdf-plus)

- Last release 0.40.31 (2025-08-30), about 15 months ago.
- Extends Obsidian's built-in view by patching its internals (`patchers/pdf-internals.ts`, ~1150 lines), with workarounds keyed on Obsidian versions (`apiVersion === '1.8.0'`, `requireApiVersion('1.9.0')` for focus and selection bugs). Its typings note that `child.pdfViewer` stopped being a class instance in 1.8.0.
- Highlights come from links in notes (`[[file.pdf#page=3&selection=…]]`), i.e. backlinks, plus optional real PDF annotations written with pdf-lib.
- **Takeaway:** patching the built-in view works but breaks with Obsidian updates. This supports SPEC §3.1 (our own view). Its subpath parser (`parsePDFSubpath`) is a good reference for §3.2.

## 4. Annotator (elias-sundqvist/obsidian-annotator)

**Not unmaintained**, as the spec assumed: version 0.3.x is a rewrite with releases in November 2026 (0.3.8 on 2026-11-23). Features from its README and source (I could not run it: auto mode blocked loading the downloaded release in the harness):

- PDFs, EPUB/FB2/Kindle books, web pages, videos. For PDFs it works **on Obsidian's built-in PDF view** (so on Electron ≥ 39 it would hit the same blank-view bug), plus its own sidebar view of annotation cards.
- One Markdown "annotation note" per source, found by an `annotation-target` property; each annotation is a block with folded Hypothesis-style JSON (`annotation-json`), quote, comment, tags, and a block id. Optional heading per annotation, a section to collect them, templates.
- Highlights in six colours and four mark styles, notes, **replies** (Hypothesis `references` → a tree, `annotation-threads.ts`), areas with a saved picture, freehand drawing, text boxes, page notes, OCR of scans, highlight-every-match, search across all annotations, export into a PDF copy, import of existing PDF annotations, Zotero / Calibre / DEVONthink links, mobile.
- Its README says Obsidian has **PDF annotation on its public roadmap** ("planned", November 2026).

**What it does not do, compared with this spec:**
- Cards **level with the passage in a margin** beside the page (Google Docs layout). It has a sidebar list.
- Resolve / re-open, priority, Docs' "↳ re:" chips and tree view.
- Copy for LLM with explicit notation.
- Independence from the built-in view (§2.1 bug).
- Consistency with my Docs plugin (same cards, same data model, same export).

## 5. Conclusions for the spec

- §3.1 stands: our own view. Load the viewer with Obsidian's `/lib/pdfjs/pdf.viewer.min.mjs` after `loadPdfJs()`; bundle `pdfjs-dist` only if that ever fails (DECISION D0.1).
- §3.2: Obsidian-compatible `selection=` links are straightforward (§2 above); support them both ways.
- §5.3: page text and offsets as described in §2 above (DECISION D0.2).
- Annotator overlaps a lot; whether to build anyway is the user's call (asked at the end of Phase 0).
