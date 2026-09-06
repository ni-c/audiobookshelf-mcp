import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  encodeFilter,
  FILTER_GROUPS,
  PROGRESS_FILTER_VALUES,
  VALUED_FILTER_GROUPS,
  VALUELESS_FILTER_GROUPS,
  type FilterGroup,
} from '../src/filters.js';
import { listFrom, truncateText } from '../src/shape.js';

/**
 * Properties of the query builder and the two readers.
 *
 * `encodeFilter` composes a value into a query parameter, and the interesting
 * question about anything that composes is whether two different inputs can
 * produce the same output — a separator that appears inside a value is the
 * classic way that happens. `listFrom` and `truncateText` read a response
 * Audiobookshelf shapes differently depending on whether the endpoint minifies,
 * which is what makes them worth stating over generated input rather than over
 * the two shapes someone had in front of them.
 */

const RUNS = { numRuns: 500 };

const valued = VALUED_FILTER_GROUPS.filter(
  (group) => group !== 'progress'
) as FilterGroup[];

describe('a filter encodes unambiguously', () => {
  /**
   * The value is base64 precisely so it cannot carry the separator. Stated over
   * arbitrary values, dots and all, rather than trusting that no name contains
   * one — a genre or a narrator's name is written by whoever runs the library.
   */
  it('a value containing the separator cannot forge another group', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...valued),
        fc.string({ minLength: 1, maxLength: 40 }),
        (group, value) => {
          const encoded = encodeFilter(group, value);
          expect(encoded.startsWith(`${group}.`)).toBe(true);
          const payload = encoded.slice(group.length + 1);
          expect(payload).not.toContain('.');
          expect(Buffer.from(payload, 'base64').toString('utf8')).toBe(value);
        }
      ),
      RUNS
    );
  });

  it('two different values never encode the same', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...valued),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (group, first, second) => {
          fc.pre(first !== second);
          expect(encodeFilter(group, first)).not.toBe(
            encodeFilter(group, second)
          );
        }
      ),
      RUNS
    );
  });

  /**
   * A missing or surplus value is refused rather than quietly dropped, and the
   * error names the group — this is the one place a caller learns which of the
   * groups take a value.
   */
  it('a valued group refuses to encode without one', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALUED_FILTER_GROUPS),
        fc.constantFrom(undefined, ''),
        (group, value) => {
          expect(() => encodeFilter(group, value)).toThrow(String(group));
        }
      ),
      RUNS
    );
  });

  it('a standalone group refuses a value and encodes to its own name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALUELESS_FILTER_GROUPS),
        fc.string({ minLength: 1, maxLength: 20 }),
        (group, value) => {
          expect(encodeFilter(group)).toBe(group);
          expect(() => encodeFilter(group, value)).toThrow(String(group));
        }
      ),
      RUNS
    );
  });

  it('an unknown group is refused, and the error lists the real ones', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (group) => {
        fc.pre(!(FILTER_GROUPS as readonly string[]).includes(group));
        expect(() => encodeFilter(group as FilterGroup, 'x')).toThrow(group);
      }),
      RUNS
    );
  });

  it('progress takes only the values it documents', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (value) => {
        fc.pre(!(PROGRESS_FILTER_VALUES as readonly string[]).includes(value));
        expect(() => encodeFilter('progress', value)).toThrow('progress');
      }),
      RUNS
    );
  });
});

describe('responses are read in whichever shape they arrive', () => {
  it('always returns an array and never invents entries', () => {
    fc.assert(
      fc.property(
        fc.array(fc.jsonValue(), { maxLength: 8 }),
        fc.constantFrom('libraries', 'items', 'users'),
        (items, key) => {
          expect(listFrom(items, key)).toEqual(items);
          expect(listFrom({ [key]: items }, key)).toEqual(items);
          expect(listFrom({ results: items }, key)).toEqual(items);
          expect(listFrom({ other: items }, key)).toEqual([]);
        }
      ),
      RUNS
    );
  });

  it('never throws, whatever the endpoint answered', () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        expect(Array.isArray(listFrom(body, 'items'))).toBe(true);
      }),
      RUNS
    );
  });
});

describe('description text is collapsed and bounded', () => {
  /**
   * Whitespace is collapsed before the length is measured, so the limit is
   * about what a reader sees rather than about how the library happened to
   * wrap its description.
   */
  it('collapses every run of whitespace to a single space', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.stringMatching(/^[a-z]{1,10}$/),
            fc.constantFrom(' ', '\n', '\t', '\r\n', '   ')
          ),
          { maxLength: 30 }
        ),
        (parts) => {
          const text = truncateText(parts.join(''), 10_000);
          if (text === undefined) return;
          expect(text).not.toMatch(/\s\s/);
          expect(text).toBe(text.trim());
        }
      ),
      RUNS
    );
  });

  /**
   * The marker carries the real length, which is the point: a reader that sees
   * a cut description needs to know whether it missed a sentence or a chapter.
   */
  it('reports the full length when it truncates', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ]{1,600}$/),
        fc.integer({ min: 1, max: 200 }),
        (raw, max) => {
          const collapsed = raw.replace(/\s+/g, ' ').trim();
          const text = truncateText(raw, max);
          if (text === undefined) return;
          if (collapsed.length <= max) {
            expect(text).toBe(collapsed);
          } else {
            expect(text).toContain(`${collapsed.length} characters total`);
            expect(text.startsWith(collapsed.slice(0, max))).toBe(true);
          }
        }
      ),
      RUNS
    );
  });

  it('a non-string is not turned into one', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.boolean(),
          fc.integer()
        ),
        (value) => {
          expect(truncateText(value)).toBeUndefined();
        }
      ),
      RUNS
    );
  });
});
