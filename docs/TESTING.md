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
- **Page colours:** the sun/coffee/moon button: normal, sepia, dark (the figure in `Two-column paper.pdf` keeps its yellow/orange hues). All open PDFs change; the choice is remembered.
- **Password:** `Protected (password test).pdf` asks; a wrong password asks again; Cancel shows "This PDF is protected by a password" with *Enter password*.
- **Memory:** scroll `Long book.pdf` to some page at 125 %, close the tab, reopen: same page and zoom. Rename the PDF: still remembered.
- **Disable the plugin** with PDFs open: the tabs switch to Obsidian's viewer at the same page; enable it again: they come back.
- **Electron 40** (the unpatched nixpkgs Obsidian): PDFs show in this view although Obsidian's own viewer is blank.

## Phase 2 (anchor and storage core)

Nothing to try in Obsidian: this phase is pure code under `src/core/`, covered by `npm test` (77 tests, many on the real text of the test PDFs in `tests/fixtures/`). Its results become visible in Phase 3.

## Phase 3 (comments)

Start from `npm run vault:reset` (comment notes of earlier tries are in `test-vault/PDF comments/`; delete them for a clean start).

- **Add a comment:** select text in `Lighthouses.pdf`, right-click → *Add comment* (or the speech-bubble-plus button, or the command). A card with a text box appears in the margin, level with the blue selection. Type, Ctrl+Enter. The text turns yellow; the card stays.
- **The note:** `PDF comments/Lighthouses.md` appears, with `commented-pdf: "[[PDFs/Lighthouses.pdf]]"`, a readable summary by page, and the data block. Its *Open* link brings you back to the comment.
- **Cards:** click a highlight → its card becomes active (and steps out). Reply, reply to a reply (↳ chip), edit, delete, ✓ resolve (the card and highlight disappear; the double-check button shows resolved ones again), priority in the ⋯ menu, tree view.
- **Across a page break:** select from the end of page 1 into page 2 → one comment highlighted on both pages.
- **Copy link to selection:** right-click a selection → *Copy link to selection*, paste in a note: `[[PDFs/Lighthouses.pdf#page=…&selection=…|Lighthouses, p.…]]`; clicking it selects the same text (also in Obsidian's viewer).
- **Navigation:** commands *Go to next / previous comment* walk through the comments in reading order.
- **Narrow pane:** make the PDF pane narrow (or open a sidebar): the margin hides and "💬 N" appears top right; it opens the comments sidebar. A new comment is then written in a small window.
- **Sidebar:** the panel-right button: all comments of the PDF in order, with quotes; search filters them; clicking a card scrolls the PDF there.
- **Page colours:** sepia and dark with comments: highlights stay visible.
- **A changed PDF:** comment on `Lighthouses.pdf`, then replace the file with `Lighthouses (revised).pdf` (copy it over the original in your file manager). A notice says how many comments moved with their text and how many were not found ("Detached comments" at the bottom of the margin).
- **Renaming the PDF** renames its note and updates its `pdf` property.
- **Your own notes are safe:** a note with a `pdf:` property pointing at a PDF (e.g. a literature note) is not touched when you comment on that PDF; a separate note is made in `PDF comments/`.
- **Editing the note by hand** (the JSON, e.g. a comment's text): the open PDF shows the change. Editing the summary instead: the next comment overwrites it, with a notice.

## Feedback round 1

- Card borders: every card has a visible edge, the active one a clear amber ring (try an AMOLED/black theme).
- Settings → PDF Comments: *Sepia paper colour* and *Dark page strength* change open PDFs at once; the reset buttons restore them.
- With the PDF focused (click a page), select text and press Ctrl+Alt+M: a new comment opens.
- Hovering a page shows no "Page N" tooltip.
- Narrow pane: the button reads "💬 N comments".
- New comment notes have `commented-pdf:`; a note from an earlier build (with `pdf:`) gets the new property on its next change.

## Phase 4 (Copy for LLM)

- In a commented PDF: Ctrl+Alt+C (or the robot button, or the command). The dialog: *Include* (text and comments / comments only / text only), *Text* (commented passages with context / pages with comments / page range / whole document), pages for a range, resolved comments. *Copy*, then paste into a note or an AI chat: passages with `⟦c1⟧…⟦/c1⟧`, then `<comments>`. A notice says how much was copied.
- The dialog opens with your last choices.

## Phase 5 (areas and polish)

- **Area comment:** Alt+drag over the figure in `Two-column paper.pdf` (or the dashed-square button, then drag): a blue box, then a card. After saving, the area is outlined in amber. In the sidebar the quote reads "[Area on page 1]". Copy for LLM marks it `⟦cN: area on page 1⟧`.
- **Copy link to comment:** card ⋯ menu → *Copy link to this comment*; paste and click the link: the PDF opens with that card active. In Obsidian's viewer the same link selects the passage.
- **Settings:** three groups (opening, comments, page colours).
- **README.md** describes installing and using the plugin.
