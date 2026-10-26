import { describe, expect, it } from 'vitest';

import {
  buildHighlightPattern,
  extractQueryTerms,
  formatBreadcrumb,
  formatSnippet,
  parseCollectionList,
  parseCollectionShow,
  parseSearchResults,
  toVaultRelativePath,
  validateStructuredQueryDocument,
} from '../../src/utils/parser';

describe('qmd parser helpers', () => {
  it('formats breadcrumbs for resolved and unresolved paths', () => {
    expect(formatBreadcrumb('notes/sub/note.md')).toBe('notes > sub');
    expect(formatBreadcrumb('note.md')).toBe('');
    expect(formatBreadcrumb('qmd://qmdzero/notes/my-note.md')).toBe('qmdzero > notes');
    expect(formatBreadcrumb('qmd://qmdzero/top.md')).toBe('qmdzero');
  });

  it('parses collection list output', () => {
    const stdout = [
      'Collections (2):',
      '',
      'obsidian (qmd://obsidian/)',
      '  Pattern:  **/*.md',
      '',
      'docs (qmd://docs/)',
      '  Pattern:  **/*.md',
    ].join('\n');

    expect(parseCollectionList(stdout)).toEqual(['obsidian', 'docs']);
  });

  it('parses collection show output', () => {
    const stdout = [
      'Collection: obsidian',
      '  Path:     /Users/test/Vault',
      '  Pattern:  **/*.md',
      '  Include:  yes (default)',
      '  Contexts: 5',
    ].join('\n');

    expect(parseCollectionShow(stdout)).toEqual({
      name: 'obsidian',
      path: '/Users/test/Vault',
      pattern: '**/*.md',
      include: 'yes (default)',
      contexts: 5,
    });
  });

  it('parses qmd json search results', () => {
    const stdout = JSON.stringify([
      {
        docid: '#abc123',
        score: 0.91,
        file: 'qmd://obsidian/folder/note.md',
        title: 'Note',
        snippet: '@@ -1,2 @@\n\nHello world',
      },
    ]);

    expect(parseSearchResults(stdout)).toEqual([
      {
        docid: '#abc123',
        score: 0.91,
        file: 'qmd://obsidian/folder/note.md',
        title: 'Note',
        snippet: '@@ -1,2 @@\n\nHello world',
      },
    ]);
  });

  it('maps qmd virtual paths back to vault-relative paths', () => {
    expect(toVaultRelativePath('qmd://obsidian/folder/note.md', 'obsidian')).toBe('folder/note.md');
    expect(toVaultRelativePath('qmd://docs/folder/note.md', 'obsidian')).toBeNull();
  });

  it('formats snippets for display', () => {
    expect(formatSnippet('@@ -1,2 @@\n\nHello   world')).toBe('Hello world');
    expect(formatSnippet('# Daily\nMade coffee.', 'Daily')).toBe('Made coffee.');
    expect(formatSnippet('## Brewing\nUse 18g.', 'Coffee')).toBe('Brewing Use 18g.');
  });

  it('validates structured query documents', () => {
    expect(validateStructuredQueryDocument('intent: related\nlex: auth\nvec: login flow')).toEqual({
      valid: true,
      normalized: 'intent: related\nlex: auth\nvec: login flow',
    });

    expect(validateStructuredQueryDocument('intent: related')).toEqual({
      valid: false,
      error: 'intent: cannot be the only line.',
    });

    expect(validateStructuredQueryDocument('plain text\nvec: auth')).toEqual({
      valid: false,
      error: 'Start each line with a type: lex, vec, hyde, or intent.',
    });
  });
});

describe('highlight terms', () => {
	it('keeps two-character CJK words and drops short ASCII words', () => {
		expect(extractQueryTerms('커피 is 핸드드립')).toEqual(['커피', '핸드드립']);
	});

	it('matches term starts in non-ASCII text', () => {
		const pattern = buildHighlightPattern(['커피', 'brew']);
		expect('핸드드립 커피는 brewing 아메리카노커피'.match(pattern)).toEqual(['커피', 'brew']);
	});
});
