import * as path from 'path';
import type { QmdCollectionInfo, QmdSearchResult } from '../types';

const COLLECTION_LINE_RE = /^(.+?)\s+\(qmd:\/\/.+\/\)\s*$/;
const VIRTUAL_PATH_RE = /^qmd:\/\/([^/]+)\/(.+)$/;
const TYPED_QUERY_RE = /^(lex|vec|hyde|intent):\s*/i;

export function normalizeFsPath(value: string): string {
	return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

export function parseCollectionList(stdout: string): string[] {
	const names: string[] = [];

	for (const rawLine of stdout.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('Collections') || line.startsWith('No collections')) {
			continue;
		}

		const match = line.match(COLLECTION_LINE_RE);
		if (!match) {
			continue;
		}

		names.push(match[1]!.trim());
	}

	return names;
}

export function parseCollectionShow(stdout: string): QmdCollectionInfo {
	const info: Partial<QmdCollectionInfo> = {};

	for (const rawLine of stdout.split('\n')) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith('Collection:')) {
			info.name = line.slice('Collection:'.length).trim();
		} else if (line.startsWith('Path:')) {
			info.path = line.slice('Path:'.length).trim();
		} else if (line.startsWith('Pattern:')) {
			info.pattern = line.slice('Pattern:'.length).trim();
		} else if (line.startsWith('Include:')) {
			info.include = line.slice('Include:'.length).trim();
		} else if (line.startsWith('Contexts:')) {
			const contexts = Number.parseInt(line.slice('Contexts:'.length).trim(), 10);
			info.contexts = Number.isFinite(contexts) ? contexts : 0;
		}
	}

	if (!info.name || !info.path) {
		throw new Error('Failed to parse qmd collection details.');
	}

	return info as QmdCollectionInfo;
}

export function parseSearchResults(stdout: string): QmdSearchResult[] {
	if (!stdout.trim()) {
		return [];
	}

	const parsed = JSON.parse(stdout) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Unexpected qmd search result payload.');
	}

	return parsed.map((item) => {
		const row = item as Record<string, unknown>;
		return {
			docid: typeof row.docid === 'string' ? row.docid : '',
			score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0),
			file: typeof row.file === 'string' ? row.file : '',
			title: typeof row.title === 'string' ? row.title : '',
			snippet: typeof row.snippet === 'string' ? row.snippet : '',
		};
	});
}

function parseVirtualPath(value: string): { collectionName: string; relativePath: string } | null {
	const match = value.match(VIRTUAL_PATH_RE);
	if (!match) {
		return null;
	}

	return {
		collectionName: match[1]!,
		relativePath: match[2]!,
	};
}

export function toVaultRelativePath(value: string, collectionName: string): string | null {
	const parsed = parseVirtualPath(value);
	if (!parsed || parsed.collectionName !== collectionName) {
		return null;
	}

	return parsed.relativePath;
}

const FRONTMATTER_KEY_RE = /^(?:aliases|tags|date_created|date_modified|cssclasses|publish|file_class|up|related|source|author|status|type|category|rating|title|description|created|modified|updated|permalink|banner|cover|image|draft|lang|weight|slug|template|parent|children|prev|next|sidebar_position|hide_table_of_contents)\s*:/i;

export function formatSnippet(snippet: string): string {
	return snippet
		.replace(/^@@.*$/gm, '')
		.replace(/^---[\s\S]*?---/m, '')
		.replace(/^---\s*$/gm, '')
		.split('\n')
		.filter((line) => !FRONTMATTER_KEY_RE.test(line.trim()))
		.join('\n')
		.replace(/\s+/g, ' ')
		.trim();
}

const STOP_WORDS = new Set([
	'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
	'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them',
	'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each',
	'from', 'they', 'into', 'also', 'more', 'other', 'which', 'their', 'about',
]);

export function extractQueryTerms(query: string): string[] {
	const words = query
		.replace(/^(lex|vec|hyde|intent):\s*/gim, ' ')
		.replace(/["""[\](){}]/g, ' ')
		.split(/\s+/)
		.map((word) => word.trim().toLowerCase())
		// CJK words are often two characters, so only ASCII words need three.
		.filter((word) => word.length >= (/^[\x20-\x7e]+$/.test(word) ? 3 : 2) && !STOP_WORDS.has(word));

	return [...new Set(words)];
}

// \b only sees ASCII word characters, so match term starts with a Unicode-aware lookbehind.
export function buildHighlightPattern(terms: string[]): RegExp {
	const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})`, 'giu');
}

export function validateStructuredQueryDocument(input: string): { valid: boolean; normalized?: string; error?: string } {
	const lines = input
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		return { valid: false, error: 'Add at least one lex:, vec:, or hyde: line.' };
	}

	let intentCount = 0;
	let typedCount = 0;

	for (const line of lines) {
		if (/^expand:/i.test(line)) {
			return { valid: false, error: 'Advanced mode accepts only lex:, vec:, hyde:, and intent: lines.' };
		}

		const match = line.match(TYPED_QUERY_RE);
		if (!match) {
			return { valid: false, error: 'Each line must start with lex:, vec:, hyde:, or intent:.' };
		}

		const prefix = match[1]!.toLowerCase();
		const text = line.slice(match[0].length).trim();
		if (!text) {
			return { valid: false, error: `${prefix}: lines must include text.` };
		}

		if (prefix === 'intent') {
			intentCount += 1;
			if (intentCount > 1) {
				return { valid: false, error: 'Only one intent: line is allowed.' };
			}
		} else {
			typedCount += 1;
		}
	}

	if (typedCount === 0) {
		return { valid: false, error: 'intent: cannot be the only line.' };
	}

	return { valid: true, normalized: lines.join('\n') };
}
