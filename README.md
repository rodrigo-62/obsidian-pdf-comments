# PDF Comments

Comment on PDFs in [Obsidian](https://obsidian.md) the way you comment in Google Docs: select a passage, write a comment, and it appears as a card in the margin, level with the passage. Reply, resolve, set a priority, comment on a figure, and copy the PDF with all its comments for an AI agent with **Copy for LLM**.

It is the sister plugin of **Docs** (margin comments for Markdown notes) and uses the same cards, threads and notation.

## Features

**A PDF view of its own**
- Opens every PDF (a header button switches to Obsidian's own viewer and back; a setting turns this off).
- Zoom (fit width, fit page, 50–400 %, Ctrl+scroll), page number box, find (Ctrl+F), outline, links inside the PDF, password-protected PDFs.
- Page colours: **normal, sepia or dark** for all PDFs at once, with an adjustable sepia paper colour and dark strength. Highlights and comments keep their own colours.
- Remembers the page and zoom of every PDF.
- Loads PDFs from their bytes, so it works even where Obsidian's own viewer shows a blank page (Obsidian on Electron ≥ 39, e.g. on NixOS).

**Comments**
- Select text, then **Ctrl+Alt+M**, right-click → *Add comment*, or the toolbar button. The card appears in the margin; Ctrl+Enter saves.
- **Area comments** on figures, formulas or scanned pages: Alt+drag a rectangle (or the area button).
- Replies (also to a single comment, with a "↳ re:" chip), tree view, edit, delete, ✓ resolve and re-open, priority (low, normal, high, critical). Comment bodies are Markdown.
- A selection can run across a page break.
- *Go to next / previous comment*, *Show resolved comments*, a comments sidebar with search (also used when the pane is too narrow for the margin: a "💬 N comments" button opens it).
- **Copy link to selection** (Obsidian's own `#page=…&selection=…` format) and **Copy link to comment**.

**Copy for LLM** (Ctrl+Alt+C or the robot button)
- Copies the commented passages with some context (or the pages with comments, a page range, or the whole PDF), with every comment written out: commented ranges become numbered markers `⟦c1⟧…⟦/c1⟧`, threads follow with page, dates and reply structure, and a short notation block explains the format.

```text
<document title="Lighthouses" source="PDFs/Lighthouses.pdf" pages="5" scope="commented passages with context">
<notation>…</notation>

<passage page="2">
… back the light it receives. ⟦c1⟧A light that cannot be told apart from the others is almost worse than no light.⟦/c1⟧ — an old harbour saying …
</passage>
</document>

<comments>
<thread id="c1" status="open" page="2" anchor="A light that cannot be told apart from the others is almost worse than no light.">
  <comment id="c1.1" date="2026-11-25 15:41">Is this the key idea?</comment>
</thread>
</comments>
```

## Where the comments are kept

The PDF is never changed. Each commented PDF gets one note in a folder (default `PDF comments/`):

```markdown
---
commented-pdf: "[[Papers/Smith 2021.pdf]]"
commented-pdf-fingerprint: "5b40c03b5abba8ab"
---
> Generated from the comments on [[Papers/Smith 2021.pdf]]. …

## Page 2

> A light that cannot be told apart from the others is almost worse than no light.

[[Papers/Smith 2021.pdf#page=2&comment=zdna|Open]]

- 2026-11-25 15:41 · Is this the key idea?

<!--pdf-comments:threads
{ … the comments, as JSON … }
-->
```

- The readable part is regenerated from the data on every change (edits to it are overwritten; edit the comments in the PDF view). Properties you add (tags, …) are kept.
- The note is tied to its PDF by the `commented-pdf` link, so it survives renames and moves; renaming the PDF also renames its note.
- A note only counts as a comment note if it has the data block: your own notes are never read or changed.
- Comments are anchored to their text. If you replace the PDF with a new version, they are found again by their text; ones that can't be found are kept under "Detached comments".

## Installation

Not in the community plugin list yet. Build it and copy it into your vault:

```sh
nix develop            # or any shell with Node 22
npm install
npm run build
npm run install-plugin -- /path/to/your/vault
```

Then enable "PDF Comments" in *Settings → Community plugins*. `npm run update-vaults` reinstalls into every vault listed in `.install-targets` (one path per line).

## Development

- `npm run dev` builds into `test-vault/.obsidian/plugins/pdf-comments/` on every change (open `test-vault/` as a vault; Hot Reload reloads the plugin).
- `npm test` (vitest, the pure code in `src/core/`), `npm run lint` (Obsidian's review rules), `npm run build`.
- `npm run vault:reset` regenerates the sample PDFs from Typst sources (needs `typst` and `qpdf`, both in `nix develop`).
- `scripts/obsidian-headless.sh` runs Obsidian headless on a copy of the test vault, and `scripts/cdp.mjs` drives it (evaluate JavaScript, screenshots).
- Design: `docs/SPEC.md`; decisions taken along the way: `docs/DECISIONS.md`; manual checks: `docs/TESTING.md`.

## Limits

- Desktop only.
- Text extraction is only as good as the PDF: some PDFs drop the hyphen of words split at a line end, and scanned PDFs have no text (use area comments).
- A comment whose selection included a footnote or page number across a page break may not be found again in a re-laid-out version of the PDF.

## License

MIT
