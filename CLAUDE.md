# PDF Comments (working name) — Obsidian plugin

A PDF view for Obsidian with Google-Docs-like margin comments. Sister project of the Docs plugin (`/home/parrhasius/code/projects/obsidian-docs-plugin`), whose comment code is reused here.

**`docs/SPEC.md` is the source of truth.** Read it before changing behaviour. Decisions that deviate from or fill gaps in the spec go in `docs/DECISIONS.md` (create it when the first one is made), with a reason.

## Working rules

- Work in the phases of SPEC §10, one at a time; stop after each with a short report.
- **Never touch any vault or file outside this repo** (reading the Docs repo to copy code is fine; never write to it). Test only in `test-vault/`. Never run `npm run update-vaults` or `install-plugin`: they write to the user's real vaults (`.install-targets`); only the user runs them.
- `src/core/` is pure TypeScript with no `obsidian` or pdf.js import, unit-tested with vitest.
- Load PDFs with `app.vault.readBinary` → `getDocument({ data })`, never through `app://` resource URLs (SPEC §2.1).
- Sidecar notes are written with `app.vault.process`, never raw `modify` on stale content.
- Look at the real UI in the headless harness (SPEC §11) before saying something works.

## Status

- Spec drafted (2026-11-25); the user answered storage (one folder), default view (yes) and digest (yes). Only the name is still open.
- **Phase 0 done** (2026-11-25): scaffold, test vault (`npm run vault:reset`, Typst + qpdf), harness (`scripts/obsidian-headless.sh`, port 9335, `OBSIDIAN_ELECTRON` for Electron 40 checks), research (`docs/RESEARCH.md`), decisions D0.1–D0.5.
- The user chose to keep building despite Annotator 0.3 (2026-11-25).
- **Phase 1 done** (viewer, DECISIONS D1.1–D1.9): `src/obsidian/pdfView.ts` (FileView on PDF.js viewer components), `findBar.ts`, `outlinePanel.ts`, `passwordModal.ts`, `settings.ts`, `main.ts` (open-by-default patch, switch buttons, commands, hand-back on disable); core `subpath.ts`, `zoom.ts`, `viewStates.ts` with tests.
- **Phase 2 done** (DECISIONS D2.1–D2.8): `src/core/pageText.ts`, `anchor.ts`, `quote.ts`, `reanchor.ts`, `sidecar.ts`, `digest.ts`, `sidecarName.ts`; Docs modules in `src/core/shared/`; fixtures from real PDF.js output in `tests/fixtures/` (regenerate with `node scripts/extract-text-fixture.mjs` after `npm run vault:reset`). 77 tests.
- **Phase 3 done** (DECISIONS D3.1–D3.9): `src/obsidian/comments/` (noteStore, commentDoc, controller, highlights, margin, selection, pageTexts, sidebarView, and card/composer/menus from Docs), `src/styles/comments.css`; page colours normal/sepia/dark (user request); "Copy link to selection" (side-agent note).
- **Next:** Phase 4 (Copy for LLM).
- Harness notes: background tabs are *deferred* (`leaf.isDeferred`, `iterateAllLeaves` skips them; walk `workspace.rootSplit` instead). Obsidian 1.15 modals have no `.modal-close-button`. Renames in the harness trigger Obsidian's "Update links?" dialog unless `app.vault.setConfig('alwaysUpdateLinks', true)` is set first. The plugin loaded at harness start is the build at that moment; reload it with disablePlugin/enablePlugin after a rebuild.

## Commands (inside `nix develop`)

- `npm run build`, `npm test`, `npm run lint`, `npm run dev` (watch into `test-vault/.obsidian/plugins/pdf-comments/`)
- `npm run vault:reset`: regenerate the sample PDFs from `scripts/vault-src/*.typ`
- Harness: `OBSIDIAN_ASAR=.scratch/obsidian-1.15.1.asar scripts/obsidian-headless.sh` (background), then `node scripts/cdp.mjs q.js [shot.png]`; stop with `pkill -f "remote-debugging-por[t]=9335"`. The vault copy is recreated on each start.
