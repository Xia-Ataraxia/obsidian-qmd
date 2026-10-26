import type { FolderRef, VaultNodeRef } from '../types';

/**
 * Converts emoji runs to their hex codepoints (mirrors QMD's emojiToHex).
 */
function emojiToHex(str: string): string {
	return str.replace(/(?:\p{So}\p{Mn}?|\p{Sk})+/gu, (run) => {
		return [...run]
			.filter((c) => /\p{So}|\p{Sk}/u.test(c))
			.map((c) => c.codePointAt(0)!.toString(16))
			.join('-');
	});
}

function slugSegment(segment: string, isLast: boolean): string {
	segment = emojiToHex(segment.toLowerCase());
	const extMatch = isLast ? segment.match(/(\.[a-z0-9]+)$/i) : null;
	const ext = extMatch ? extMatch[1] : '';
	const base = ext ? segment.slice(0, -ext.length) : segment;
	return base.replace(/[^\p{L}\p{N}$]+/gu, '-').replace(/^-+|-+$/g, '') + ext;
}

/**
 * Replicates QMD's handelize() — converts a vault-relative path to the
 * slugified form QMD uses in virtual paths (qmd://collection/…).
 */
export function handelize(path: string): string {
	return path
		.split('/')
		.map((segment, idx, arr) => slugSegment(segment, idx === arr.length - 1))
		.filter(Boolean)
		.join('/');
}

/**
 * Maps a QMD slugified path back to real vault paths by descending only the
 * folders on that path, so the vault is never listed as a whole.
 * Returns every match (at most 2); more than one means the slug is ambiguous.
 */
export function resolveSlugPath(slugifiedPath: string, root: FolderRef): string[] {
	const segments = slugifiedPath.split('/').filter(Boolean);
	const matches: string[] = [];

	const walk = (nodes: VaultNodeRef[], idx: number): void => {
		for (const node of nodes) {
			if (matches.length > 1) return;
			const slug = slugSegment(node.name, !node.children);
			// handelize() drops segments that slugify to nothing, so such folders are transparent.
			if (node.children && slug === '') {
				walk(node.children, idx);
			} else if (slug === segments[idx]) {
				if (idx < segments.length - 1) {
					if (node.children) walk(node.children, idx + 1);
				} else if (!node.children) {
					matches.push(node.path);
				}
			}
		}
	};

	if (segments.length > 0) walk(root.children, 0);
	return matches;
}
