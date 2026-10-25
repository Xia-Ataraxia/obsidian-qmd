import { describe, expect, it } from 'vitest';
import { parseLegacyData } from '../../src/domain/legacy-data';

describe('parseLegacyData', () => {
  it('returns objects only', () => {
    expect(parseLegacyData('{"a":1}')).toEqual({ a: 1 });
    expect(parseLegacyData('[1]')).toBeNull();
    expect(parseLegacyData('null')).toBeNull();
    expect(parseLegacyData('{oops')).toBeNull();
  });
});
