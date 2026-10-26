import type { FileRef } from '../types';

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

/**
 * Replicates QMD's handelize() — converts a vault-relative path to the
 * slugified form QMD uses in virtual paths (qmd://collection/…).
 */
export function handelize(path: string): string {
	return path
		.toLowerCase()
		.split('/')
		.map((segment, idx, arr) => {
			const isLast = idx === arr.length - 1;
			segment = emojiToHex(segment);

			if (isLast) {
				const extMatch = segment.match(/(\.[a-z0-9]+)$/i);
				const ext = extMatch ? extMatch[1] : '';
				const base = ext ? segment.slice(0, -ext.length) : segment;
				const cleaned = base
					.replace(/[^\p{L}\p{N}$]+/gu, '-')
					.replace(/^-+|-+$/g, '');
				return cleaned + ext;
			}

			return segment
				.replace(/[^\p{L}\p{N}$]+/gu, '-')
				.replace(/^-+|-+$/g, '');
		})
		.filter(Boolean)
		.join('/');
}

/**
 * Maintains a bidirectional map between QMD's slugified paths and actual
 * vault-relative paths, enabling correct file resolution from search results.
 */
export class VaultPathResolver {
	private slugToReal = new Map<string, string>();
	private ambiguousSlugs = new Set<string>();
	private dirty = true;

	markDirty(): void {
		this.dirty = true;
	}

	rebuild(files: FileRef[]): void {
		this.slugToReal.clear();
		this.ambiguousSlugs.clear();
		for (const file of files) {
			try {
				const slug = handelize(file.path);
				if (this.ambiguousSlugs.has(slug)) {
					continue;
				}
				if (this.slugToReal.has(slug)) {
					this.slugToReal.delete(slug);
					this.ambiguousSlugs.add(slug);
					continue;
				}
				this.slugToReal.set(slug, file.path);
			} catch {
				// Skip files that handelize() rejects (no valid content).
			}
		}
		this.dirty = false;
	}

	// Lazy so a clean map never re-lists the vault.
	rebuildIfDirty(listFiles: () => FileRef[]): void {
		if (this.dirty) {
			this.rebuild(listFiles());
		}
	}

	isAmbiguous(slugifiedPath: string): boolean {
		return this.ambiguousSlugs.has(slugifiedPath);
	}

	resolve(slugifiedPath: string): string | null {
		if (this.ambiguousSlugs.has(slugifiedPath)) {
			return null;
		}
		return this.slugToReal.get(slugifiedPath) ?? null;
	}
}
