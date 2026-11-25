// Copied from the Docs plugin (tests/textFormat.test.ts, commit 13957fe).
import { describe, expect, it } from 'vitest';
import { insertLink, toggleWrap, type TextEdit } from '../../src/core/shared/textFormat';

const apply = (text: string, e: TextEdit) => {
	const out = text.slice(0, e.from) + e.insert + text.slice(e.to);
	return { out, sel: out.slice(e.selStart, e.selEnd) };
};

describe('toggleWrap', () => {
	it('wraps the selection and keeps it selected', () => {
		expect(apply('a word b', toggleWrap('a word b', 2, 6, '**'))).toEqual({ out: 'a **word** b', sel: 'word' });
	});
	it('puts the caret between markers when nothing is selected', () => {
		const e = toggleWrap('ab', 1, 1, '**');
		expect(apply('ab', e).out).toBe('a****b');
		expect(e.selStart).toBe(3);
	});
	it('unwraps markers around or inside the selection', () => {
		expect(apply('a **word** b', toggleWrap('a **word** b', 4, 8, '**'))).toEqual({ out: 'a word b', sel: 'word' });
		expect(apply('a **word** b', toggleWrap('a **word** b', 2, 10, '**'))).toEqual({ out: 'a word b', sel: 'word' });
	});
});

describe('insertLink', () => {
	it('makes the selection the link text, caret in the URL', () => {
		const e = insertLink('see this', 4, 8);
		expect(apply('see this', e).out).toBe('see [this]()');
		expect(e.selStart).toBe('see [this]('.length);
	});
	it('puts a selected URL in the target, caret in the text', () => {
		const e = insertLink('https://x.org', 0, 13);
		expect(apply('https://x.org', e).out).toBe('[](https://x.org)');
		expect(e.selStart).toBe(1);
	});
	it('inserts an empty link with nothing selected', () => {
		expect(apply('', insertLink('', 0, 0)).out).toBe('[]()');
	});
});
