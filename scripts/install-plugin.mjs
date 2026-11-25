// Install the built plugin into another vault:
//   npm run build && npm run install-plugin -- /path/to/vault
// Copies main.js, styles.css and manifest.json into <vault>/.obsidian/plugins/pdf-comments/.
// It does not enable the plugin on a first install.
import { installInto } from './install-lib.mjs';

const vault = process.argv[2];
if (!vault) {
	console.error('usage: npm run install-plugin -- /path/to/vault');
	process.exit(1);
}
try {
	for (const n of installInto(vault)) console.log(n);
	console.log('Done. Without Hot Reload in that vault: toggle "PDF Comments" off and on, or Ctrl+P → "Reload app without saving".');
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
