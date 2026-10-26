import { describe, expect, it, vi } from 'vitest';
import { handelize, resolveSlugPath } from '../../src/domain/path-resolver';

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

describe('resolveSlugPath', () => {
	type Node = { path: string; name: string; children?: Node[] };
	// Builds a folder tree from flat paths, standing in for vault.getRoot().
	const tree = (paths: string[]): Node & { children: Node[] } => {
		const root = { path: '/', name: '', children: [] as Node[] };
		for (const path of paths) {
			let folder = root;
			const parts = path.split('/');
			parts.forEach((name, idx) => {
				const childPath = parts.slice(0, idx + 1).join('/');
				if (idx === parts.length - 1) {
					folder.children.push({ path: childPath, name });
					return;
				}
				let next = folder.children.find((c) => c.path === childPath);
				if (!next) {
					next = { path: childPath, name, children: [] };
					folder.children.push(next);
				}
				folder = next as typeof root;
			});
		}
		return root;
	};

	it('resolves slugified paths to real vault paths', () => {
		const root = tree([
			'12. Area/Obsidian Plugin/Obsidian Plugin.md',
			'00. Inbox/Obsidian Plugin - Plugin Groups.md',
		]);
		expect(resolveSlugPath('12-area/obsidian-plugin/obsidian-plugin.md', root))
			.toEqual(['12. Area/Obsidian Plugin/Obsidian Plugin.md']);
		expect(resolveSlugPath('00-inbox/obsidian-plugin-plugin-groups.md', root))
			.toEqual(['00. Inbox/Obsidian Plugin - Plugin Groups.md']);
	});

	it('returns nothing for unknown paths', () => {
		expect(resolveSlugPath('nonexistent.md', tree(['a.md']))).toEqual([]);
		expect(resolveSlugPath('', tree(['a.md']))).toEqual([]);
	});

	it('descends only the folders on the slug path', () => {
		const root = tree(['Inbox/Note.md', 'Archive/Deep/Other.md']);
		const deep = root.children.find((c) => c.name === 'Archive')!.children![0]!;
		const deepChildren = deep.children;
		const read = vi.fn(() => deepChildren);
		Object.defineProperty(deep, 'children', { get: read });
		expect(resolveSlugPath('inbox/note.md', root)).toEqual(['Inbox/Note.md']);
		expect(read).not.toHaveBeenCalled();
	});

	it('reports colliding slugs instead of picking an arbitrary file', () => {
		const root = tree(['Inbox/My Note.md', 'Inbox/My--Note.md', 'Inbox/Unique.md']);
		expect(resolveSlugPath('inbox/my-note.md', root)).toHaveLength(2);
		expect(resolveSlugPath('inbox/unique.md', root)).toEqual(['Inbox/Unique.md']);
	});

	it('matches handelize for every file in the tree', () => {
		const paths = ['00. Inbox/My Note.md', '12. Area/온슬/2026-02-26 온슬.md', '--/Hidden.md', 'Hot Reload.obsidian.plugin.md'];
		const root = tree(paths);
		for (const path of paths) {
			expect(resolveSlugPath(handelize(path), root)).toEqual([path]);
		}
	});
});
