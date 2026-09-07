import { z } from 'zod';

import { DETAIL_DESCRIPTION, DETAIL_LEVELS } from './shape.js';

/** Upper bound for every paginated tool, so one call cannot flood the context. */
export const MAX_LIMIT = 100;

/**
 * Longest identifier this server will pass on.
 *
 * Audiobookshelf ids are UUIDs on current servers and prefixed slugs on older
 * ones, so 128 is generous by a factor of three. The point is that there is a
 * number at all: an id goes into a URL path, into a confirmation sentence and
 * into an error message, and `z.string().min(1)` let a caller put a megabyte
 * into all three.
 */
export const MAX_ID_LENGTH = 128;

/** Longest free-text argument: a search query, a sort key, a filter value. */
export const MAX_QUERY_LENGTH = 500;
export const MAX_SORT_LENGTH = 100;
export const MAX_FILTER_VALUE_LENGTH = 1000;

/**
 * Highest page number and playback position accepted.
 *
 * `page` multiplies with `limit` into a sentence the tool writes back, and
 * `time` goes into a URL path — `String(1e21)` is `"1e+21"`, which is neither
 * a position nor something the API can answer for.
 */
export const MAX_PAGE = 1_000_000;
export const MAX_TIME_SECONDS = 1_000_000_000;

/** An identifier argument: bounded, and described where it comes from. */
export function idParam(description: string) {
  return z.string().min(1).max(MAX_ID_LENGTH).describe(description);
}

export const detailParam = z
  .enum(DETAIL_LEVELS)
  .optional()
  .describe(DETAIL_DESCRIPTION);

export const libraryIdParam = idParam(
  'Library id, as returned by list_libraries'
);

export const libraryItemIdParam = idParam(
  'Library item id, as returned by list_library_items or search_library'
);

export const pageParam = z
  .number()
  .int()
  .min(0)
  .max(MAX_PAGE)
  .optional()
  .describe('0-based page number, default 0');

export function limitParam(defaultLimit: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Number of entries to return, default ${defaultLimit}, max ${MAX_LIMIT}`
    );
}

export const confirmTokenParam = z
  .string()
  .max(MAX_ID_LENGTH)
  .optional()
  .describe('Token from the first call of this tool');
