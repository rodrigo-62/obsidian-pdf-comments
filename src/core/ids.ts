// Thread ids (copied from the Docs plugin, src/core/markers.ts `generateId`, commit 13957fe).
// Short random base36 strings starting with a letter, unique among `existing`.

export function generateId(existing: Iterable<string>, random: () => number = Math.random, length = 4): string {
	const taken = new Set(existing);
	for (let attempt = 0; attempt < 1000; attempt++) {
		const len = length + Math.floor(attempt / 50);
		let id = '';
		for (let i = 0; i < len; i++) id += Math.floor(random() * 36).toString(36);
		// Start with a letter so ids never look like numbers.
		if (!/^[a-z]/.test(id)) id = String.fromCharCode(97 + Math.floor(random() * 26)) + id.slice(1);
		if (!taken.has(id)) return id;
	}
	throw new Error('could not generate a unique id');
}
