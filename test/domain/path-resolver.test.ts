import { describe, expect, it } from 'vitest';
import { handelize, VaultPathResolver } from '../../src/domain/path-resolver';

describe('handelize', () => {
	it('lowercases and replaces spaces with hyphens', () => {
		expect(handelize('Obsidian Plugin.md')).toBe('obsidian-plugin.md');
	});

	it('handles numbered folders with dots and spaces', () => {
		expect(handelize('00. Inbox/My Note.md')).toBe('00-inbox/my-note.md');
		expect(handelize('12. Area/Obsidian Plugin/Obsidian Plugin.md'))
			.toBe('12-area/obsidian-plugin/obsidian-plugin.md');
	});

	it('handles hyphens and special characters in filenames', () => {
		expect(handelize('00. Inbox/Obsidian Plugin - Plugin Groups.md'))
			.toBe('00-inbox/obsidian-plugin-plugin-groups.md');
	});

	it('handles dots within filenames (not just extension)', () => {
		expect(handelize('Hot Reload.obsidian.plugin.md'))
			.toBe('hot-reload-obsidian-plugin.md');
	});

	it('preserves Korean characters', () => {
		expect(handelize('12. Area/온슬/2026-02-26 온슬.md'))
			.toBe('12-area/온슬/2026-02-26-온슬.md');
	});

	it('preserves .md extension', () => {
		expect(handelize('test.md')).toBe('test.md');
	});
});

describe('VaultPathResolver', () => {
	const makeTFile = (path: string) => ({ path }) as { path: string };

	it('resolves slugified paths to real vault paths', () => {
		const resolver = new VaultPathResolver();
		const files = [
			makeTFile('12. Area/Obsidian Plugin/Obsidian Plugin.md'),
			makeTFile('00. Inbox/Obsidian Plugin - Plugin Groups.md'),
		];

		resolver.rebuild(files as never[]);

		expect(resolver.resolve('12-area/obsidian-plugin/obsidian-plugin.md'))
			.toBe('12. Area/Obsidian Plugin/Obsidian Plugin.md');
		expect(resolver.resolve('00-inbox/obsidian-plugin-plugin-groups.md'))
			.toBe('00. Inbox/Obsidian Plugin - Plugin Groups.md');
	});

	it('returns null for unknown paths', () => {
		const resolver = new VaultPathResolver();
		resolver.rebuild([]);
		expect(resolver.resolve('nonexistent.md')).toBeNull();
	});

	it('respects dirty flag for lazy rebuild', () => {
		const resolver = new VaultPathResolver();
		const files = [makeTFile('test.md')];

		resolver.rebuildIfDirty(files as never[]);
		expect(resolver.resolve('test.md')).toBe('test.md');

		// After rebuild, not dirty — won't rebuild even with different files
		resolver.rebuildIfDirty([makeTFile('other.md')] as never[]);
		expect(resolver.resolve('test.md')).toBe('test.md');

		// Mark dirty — next rebuildIfDirty will rebuild
		resolver.markDirty();
		resolver.rebuildIfDirty([makeTFile('other.md')] as never[]);
		expect(resolver.resolve('test.md')).toBeNull();
		expect(resolver.resolve('other.md')).toBe('other.md');
	});

	it('does not resolve colliding slugs to an arbitrary file', () => {
		const resolver = new VaultPathResolver();
		const files = [
			makeTFile('Inbox/My Note.md'),
			makeTFile('Inbox/My--Note.md'),
			makeTFile('Inbox/Unique.md'),
		];

		resolver.rebuild(files as never[]);

		expect(resolver.isAmbiguous('inbox/my-note.md')).toBe(true);
		expect(resolver.isAmbiguous('inbox/unique.md')).toBe(false);
		expect(resolver.resolve('inbox/my-note.md')).toBeNull();
		expect(resolver.resolve('inbox/unique.md')).toBe('Inbox/Unique.md');
	});
});
