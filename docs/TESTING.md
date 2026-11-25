# Manual checks

Things to try by hand in Obsidian, grouped by phase. Use the test vault (`test-vault/`, regenerate PDFs with `npm run vault:reset` inside `nix develop`), not a real vault.

## Phase 0 (setup)

- `nix develop -c npm run vault:reset` writes 7 PDFs under `test-vault/PDFs/` and `Start here.md`.
- Open `test-vault` as a vault in Obsidian: all PDFs open in the built-in viewer (on the Electron 37 override). `Protected (password test).pdf` asks for the password `test`. `Long book.pdf` has 302 pages.
- `nix develop -c npm run build` and `npm test` pass. The plugin "PDF Comments" can be enabled; it does nothing yet.
