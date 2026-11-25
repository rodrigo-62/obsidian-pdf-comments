// Shared by install-plugin.mjs and update-vaults.mjs: install the built plugin into a vault.
// Only the plugin's own files are written (main.js, styles.css, manifest.json, and an empty
// .hotreload marker); its settings (data.json) and your notes are left alone.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ID = 'pdf-comments';

/** Returns a list of human-readable notes about what was done. Throws if `vault` isn't a vault. */
export function installInto(vault) {
	const root = resolve(vault);
	const cfg = join(root, '.obsidian');
	if (!existsSync(cfg)) throw new Error(`${root} has no .obsidian folder; is it an Obsidian vault?`);
	for (const f of ['dist/main.js', 'dist/styles.css']) if (!existsSync(f)) throw new Error(`${f} is missing; run "npm run build" first.`);
	const dest = join(cfg, 'plugins', ID);
	const first = !existsSync(join(dest, 'manifest.json'));
	mkdirSync(dest, { recursive: true });
	copyFileSync('dist/main.js', join(dest, 'main.js'));
	copyFileSync('dist/styles.css', join(dest, 'styles.css'));
	copyFileSync('manifest.json', join(dest, 'manifest.json'));
	// Lets the Hot Reload plugin (if installed in that vault) reload the plugin automatically.
	if (!existsSync(join(dest, '.hotreload'))) writeFileSync(join(dest, '.hotreload'), '');
	const notes = [`installed into ${dest}`];
	if (first) notes.push('first install: enable "PDF Comments" in Settings → Community plugins');
	return notes;
}
