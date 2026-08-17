import { z } from 'zod';

import { DETAIL_DESCRIPTION, DETAIL_LEVELS } from './shape.js';

/** Upper bound for every paginated tool, so one call cannot flood the context. */
export const MAX_LIMIT = 100;

export const detailParam = z
  .enum(DETAIL_LEVELS)
  .optional()
  .describe(DETAIL_DESCRIPTION);

export const libraryIdParam = z
  .string()
  .min(1)
  .describe('Library id, as returned by list_libraries');

export const libraryItemIdParam = z
  .string()
  .min(1)
  .describe(
    'Library item id, as returned by list_library_items or search_library'
  );

export const pageParam = z
  .number()
  .int()
  .min(0)
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
  .optional()
  .describe('Token from the first call of this tool');
