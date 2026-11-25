# Manual checks

Things to try by hand in Obsidian, grouped by phase. Use the test vault (`test-vault/`, regenerate PDFs with `npm run vault:reset` inside `nix develop`), not a real vault.

## Phase 0 (setup)

- `nix develop -c npm run vault:reset` writes 7 PDFs under `test-vault/PDFs/` and `Start here.md`.
- Open `test-vault` as a vault in Obsidian: all PDFs open in the built-in viewer (on the Electron 37 override). `Protected (password test).pdf` asks for the password `test`. `Long book.pdf` has 302 pages.
- `nix develop -c npm run build` and `npm test` pass. The plugin "PDF Comments" can be enabled; it does nothing yet.

## Phase 1 (viewer)

Enable "PDF Comments" in the test vault (`npm run build` first).

- **Opening:** click a PDF in the file explorer: it opens in the new view (toolbar with outline, page box, zoom, find, moon). From `Start here.md`, the links `#page=3` and `#page=150` open at that page.
- **Switching:** the book icon in the header opens the same page in Obsidian's viewer; there, the speech-bubble icon switches back. A tab switched to Obsidian's viewer stays there when you open another PDF in it.
- **Obsidian's selection links:** in Obsidian's viewer, select a sentence, *Copy link to selection*, paste it in a note, switch the setting on and click the link: our view opens with the same text selected.
- **Zoom:** the dropdown (Fit width shows its percentage), − / +, Ctrl+wheel (about 10 % per notch, around the pointer). Resize the pane: Fit width follows.
- **Navigation:** type a page number + Enter; arrow keys, Page Up/Down, Home/End after clicking the page; commands *Next page* / *Previous page*.
- **Find:** Ctrl+F (or the magnifier) with a word selected pre-fills it; Enter / Shift+Enter, match case, whole words, "3 of 10", Esc closes and removes the highlights.
- **Outline:** the list icon; click "II. The lens" in `Lighthouses.pdf`; the long book's 50 chapters.
- **Links inside the PDF:** the contents entries and "the section on the lens" jump; "example.org" on the last page opens the browser.
- **Dark pages:** the moon inverts the pages (the figure in `Two-column paper.pdf` keeps its yellow/orange hues). Setting for the default.
- **Password:** `Protected (password test).pdf` asks; a wrong password asks again; Cancel shows "This PDF is protected by a password" with *Enter password*.
- **Memory:** scroll `Long book.pdf` to some page at 125 %, close the tab, reopen: same page and zoom. Rename the PDF: still remembered.
- **Disable the plugin** with PDFs open: the tabs switch to Obsidian's viewer at the same page; enable it again: they come back.
- **Electron 40** (the unpatched nixpkgs Obsidian): PDFs show in this view although Obsidian's own viewer is blank.
