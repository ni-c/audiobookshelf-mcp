/**
 * Encoding for the `filter` query parameter of `GET /api/libraries/:id/items`.
 *
 * Audiobookshelf expects `<group>.<base64(value)>` and decodes the part after
 * the first dot with `Buffer.from(decodeURIComponent(text), 'base64')`. The
 * group list below is the server's own `searchGroups` array — a group that is
 * not in it is treated as a valueless filter, so a typo silently returns the
 * unfiltered library instead of an error. That is why this module validates
 * rather than just concatenating.
 *
 * Source of truth: server/utils/queries/libraryFilters.js in advplyr/audiobookshelf.
 */

/** Filter groups that require a value. */
export const VALUED_FILTER_GROUPS = [
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
] as const;

/** Filter groups that stand alone and take no value. */
export const VALUELESS_FILTER_GROUPS = [
  'issues',
  'feed-open',
  'share-open',
  'recent',
] as const;

export type ValuedFilterGroup = (typeof VALUED_FILTER_GROUPS)[number];
export type ValuelessFilterGroup = (typeof VALUELESS_FILTER_GROUPS)[number];
export type FilterGroup = ValuedFilterGroup | ValuelessFilterGroup;

export const FILTER_GROUPS: readonly FilterGroup[] = [
  ...VALUED_FILTER_GROUPS,
  ...VALUELESS_FILTER_GROUPS,
];

/** Accepted values of the `progress` group. */
export const PROGRESS_FILTER_VALUES = [
  'finished',
  'in-progress',
  'not-started',
  'not-finished',
] as const;

function isValued(group: FilterGroup): group is ValuedFilterGroup {
  return (VALUED_FILTER_GROUPS as readonly string[]).includes(group);
}

/**
 * Builds the value of the `filter` query parameter.
 *
 * `value` is the *plain* value — an id for `authors`/`series`, a literal for
 * `progress`, a name for `genres`/`tags`/`narrators`. The base64 step happens
 * here so no caller has to think about it.
 */
export function encodeFilter(group: FilterGroup, value?: string): string {
  if (!FILTER_GROUPS.includes(group)) {
    throw new Error(
      `unknown filter group "${group}": expected one of ${FILTER_GROUPS.join(', ')}`
    );
  }
  if (isValued(group)) {
    if (value === undefined || value === '') {
      throw new Error(
        `filter group "${group}" requires filter_value (e.g. an id for authors/series, ` +
          `a name for genres/tags/narrators, one of ${PROGRESS_FILTER_VALUES.join('/')} for progress)`
      );
    }
    if (
      group === 'progress' &&
      !(PROGRESS_FILTER_VALUES as readonly string[]).includes(value)
    ) {
      throw new Error(
        `filter_value for group "progress" must be one of ${PROGRESS_FILTER_VALUES.join(', ')}`
      );
    }
    return `${group}.${Buffer.from(value, 'utf8').toString('base64')}`;
  }
  if (value !== undefined && value !== '') {
    throw new Error(`filter group "${group}" does not take a filter_value`);
  }
  return group;
}

/** Human-readable list for tool descriptions. */
export function describeFilterGroups(): string {
  return (
    `valued (need filter_value): ${VALUED_FILTER_GROUPS.join(', ')}; ` +
    `standalone: ${VALUELESS_FILTER_GROUPS.join(', ')}`
  );
}
