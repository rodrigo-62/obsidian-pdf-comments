#!/usr/bin/env bash
# Run Obsidian headless (Xvfb) on a fresh COPY of test-vault/ (in .scratch/headless-vault,
# so it never shares files with an Obsidian you have open), with an isolated profile in
# .scratch/, remote-debuggable on port 9335 (Docs uses 9333). Never touches ~/.config/obsidian or other vaults.
# The copy's plugin build files are symlinks to the real build output, so rebuilds are picked up.
# Then: nix develop -c node scripts/cdp.mjs file-with-js.js [screenshot.png]
# Stop: pkill -f "remote-debugging-por[t]=9335"
# Options (env):
#   OBSIDIAN_ASAR=/path/obsidian-1.x.y.asar  run that (newer) app version, e.g. a copy of the auto-updated one
#   OBSIDIAN_ELECTRON=/nix/store/…-electron-40…/bin/electron  run on another Electron (default: the installed wrapper's)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$ROOT/.scratch/obsidian-headless-profile"
VAULT="$ROOT/.scratch/headless-vault"
ID=pdf-comments
rm -rf "$VAULT"
cp -r "$ROOT/test-vault" "$VAULT"
rm -f "$VAULT/.obsidian/workspace.json"
mkdir -p "$VAULT/.obsidian/plugins/$ID"
for f in main.js styles.css manifest.json; do
	rm -f "$VAULT/.obsidian/plugins/$ID/$f"
	ln -s "$ROOT/test-vault/.obsidian/plugins/$ID/$f" "$VAULT/.obsidian/plugins/$ID/$f"
done
mkdir -p "$PROFILE/obsidian"
if [ -n "${OBSIDIAN_ASAR:-}" ]; then cp "$OBSIDIAN_ASAR" "$PROFILE/obsidian/"; fi
cat > "$PROFILE/obsidian/obsidian.json" <<JSON
{"vaults":{"pdfc0testvault00":{"path":"$VAULT","ts":1700000000000,"open":true}},"updateDisabled":true}
JSON
OBS="$(readlink -f "$(command -v obsidian)")"
# The nixpkgs wrapper execs: electron <app.asar> …; reuse both paths.
ELECTRON="${OBSIDIAN_ELECTRON:-$(grep -o '/nix/store/[^"]*/bin/electron' "$OBS" | head -1)}"
ASAR="$(grep -o '/nix/store/[^" ]*/app.asar' "$OBS" | head -1)"
export XDG_CONFIG_HOME="$PROFILE"
unset WAYLAND_DISPLAY NIXOS_OZONE_WL LD_LIBRARY_PATH ELECTRON_OZONE_PLATFORM_HINT
exec nix shell nixpkgs#xvfb-run --command xvfb-run -a -s "-screen 0 1600x1000x24" \
	"$ELECTRON" "$ASAR" --user-data-dir="$PROFILE/obsidian" --remote-debugging-port=9335 --no-sandbox --ozone-platform=x11
