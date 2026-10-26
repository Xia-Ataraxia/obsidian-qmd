import { describe, expect, it } from 'vitest';

import { buildEmbedArgs, buildUpdateArgs } from '../../src/utils/sync-args';

describe('sync args', () => {
  it('scopes embed to the active collection', () => {
    expect(buildEmbedArgs(' notes ')).toEqual(['embed', '-c', 'notes']);
  });

  it('never builds an unscoped embed', () => {
    expect(() => buildEmbedArgs('  ')).toThrow();
  });

  it('builds update without a collection flag', () => {
    expect(buildUpdateArgs()).toEqual(['update']);
  });
});
