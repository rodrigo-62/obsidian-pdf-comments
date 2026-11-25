// Adapted from the Docs plugin (obsidian/menus.ts, commit 13957fe): CSS prefix folio- → pdfc-, imports.
// "SPEC §" and "DECISIONS" references below are to the Docs plugin's documents.

// One context menu at a time (DECISIONS F9.4). Comment menus stop the event
// from bubbling, so Obsidian never saw the second right-click that normally
// closes an open menu, and menus piled up.

import type { Menu } from 'obsidian';

let open: Menu | null = null;

/** Show `menu`, closing a menu this plugin opened before. */
export function showMenu(menu: Menu, e: MouseEvent): void {
	open?.hide();
	open = menu;
	menu.onHide(() => {
		if (open === menu) open = null;
	});
	menu.showAtMouseEvent(e);
}

/** Is one of this plugin's menus open (e.g. the priority menu of a comment box)? */
export function isMenuOpen(): boolean {
	return open !== null;
}
