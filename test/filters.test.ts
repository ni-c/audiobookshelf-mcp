import { describe, expect, it } from 'vitest';

import {
  describeFilterGroups,
  encodeFilter,
  FILTER_GROUPS,
} from '../src/filters.js';

/** Mirrors the server's `Buffer.from(decodeURIComponent(text), 'base64')`. */
function decodeFilter(filter: string): { group: string; value: string | null } {
  const searchGroups = [
    'genres',
    'tags',
    'series',
    'authors',
    'progress',
    'narrators',
    'publishers',
    'publishedDecades',
    'missing',
    'languages',
    'tracks',
    'ebooks',
  ];
  const group = searchGroups.find((g) => filter.startsWith(`${g}.`));
  return {
    group: group ?? filter,
    value: group
      ? Buffer.from(filter.replace(`${group}.`, ''), 'base64').toString()
      : null,
  };
}

describe('encodeFilter', () => {
  it('base64-encodes the value of a valued group', () => {
    const filter = encodeFilter('authors', 'aut_z3leimgybl7uf3y4ab');
    expect(filter).toBe('authors.YXV0X3ozbGVpbWd5Ymw3dWYzeTRhYg==');
    expect(decodeFilter(filter)).toEqual({
      group: 'authors',
      value: 'aut_z3leimgybl7uf3y4ab',
    });
  });

  it('round-trips values containing non-ASCII characters', () => {
    const filter = encodeFilter('genres', 'Science-Fiction & Fantasy');
    expect(decodeFilter(filter)).toEqual({
      group: 'genres',
      value: 'Science-Fiction & Fantasy',
    });
  });

  it('leaves a standalone group unencoded', () => {
    expect(encodeFilter('issues')).toBe('issues');
    expect(decodeFilter('issues')).toEqual({ group: 'issues', value: null });
  });

  it('rejects a valued group without a value', () => {
    // Without this check the filter would be sent as the bare group name, which
    // the server reads as a standalone filter — it answers 200 with the
    // unfiltered library instead of failing.
    expect(() => encodeFilter('series')).toThrow(/requires filter_value/);
  });

  it('rejects a value on a standalone group', () => {
    expect(() => encodeFilter('recent', 'yes')).toThrow(
      /does not take a filter_value/
    );
  });

  it('rejects an unknown filter group', () => {
    expect(() =>
      encodeFilter('nonsense' as unknown as (typeof FILTER_GROUPS)[number])
    ).toThrow(/unknown filter group/);
  });

  it('validates the values of the progress group', () => {
    expect(decodeFilter(encodeFilter('progress', 'finished')).value).toBe(
      'finished'
    );
    expect(() => encodeFilter('progress', 'halfway')).toThrow(/must be one of/);
  });

  it('describes every group for the tool description', () => {
    const described = describeFilterGroups();
    for (const group of FILTER_GROUPS) {
      expect(described).toContain(group);
    }
  });
});
