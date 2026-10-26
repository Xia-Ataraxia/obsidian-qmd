export type QmdSearchMode = 'keyword' | 'semantic' | 'hybrid' | 'advanced';
export type QmdOpenTarget = 'current' | 'tab' | 'split';

export interface QmdSearchResult {
	docid: string;
	score: number;
	file: string;
	title: string;
	snippet: string;
}

export interface QmdCollectionInfo {
	name: string;
	path: string;
	pattern?: string;
	include?: string;
	contexts?: number;
}

export type SyncPhase = 'idle' | 'syncing' | 'embedding' | 'error';

export interface SyncState {
	phase: SyncPhase;
	message: string;
	error?: string;
}

export interface QmdPluginSettings {
	qmdExecutablePath: string;
	collectionOverride: string;
	defaultSearchMode: QmdSearchMode;
	lastSearchMode: QmdSearchMode;
	previewResultLimit: number;
	relatedResultLimit: number;
	autoSyncEnabled: boolean;
	autoSyncDebounceMs: number;
	persistLastMode: boolean;
	showModeSelector: boolean;
	showSyncStatusBar: boolean;
	plugin_notices: { muted: Record<string, boolean> };
}

export interface RelatedQuerySource {
	title: string;
	aliases: string[];
	tags: string[];
	headings: string[];
}

export interface CachedRelatedResult {
	results: QmdSearchResult[];
	timestamp: number;
}

/**
 * Minimal shim for obsidian's CachedMetadata — keeps domain/utils
 * free of obsidian imports while remaining structurally compatible.
 */
export interface NoteMetadata {
	frontmatter?: Record<string, unknown>;
	tags?: Array<{ tag: string }>;
	headings?: Array<{ heading: string }>;
}

/**
 * Minimal shim for obsidian's TFile — only the fields domain code needs.
 */
export interface VaultNodeRef {
	path: string;
	name: string;
	children?: VaultNodeRef[];
}

export interface FolderRef extends VaultNodeRef {
	children: VaultNodeRef[];
}
