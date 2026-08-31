import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  describeFilterGroups,
  encodeFilter,
  FILTER_GROUPS,
  PROGRESS_FILTER_VALUES,
} from '../filters.js';
import {
  detailParam,
  libraryIdParam,
  limitParam,
  pageParam,
} from '../schema.js';
import {
  compactAuthor,
  compactItemPage,
  compactLibrary,
  compactLibraryItem,
  compactSeries,
  listFrom,
} from '../shape.js';

import { assertPathSegment, query, type AudiobookshelfApi } from '../api.js';
import { jsonResult, run, untrustedJsonResult } from '../result.js';

const DEFAULT_ITEM_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 12;

/**
 * Sort keys Audiobookshelf understands. It ignores unknown keys silently and
 * falls back to the default order, so the useful ones are spelled out for the
 * model instead of being left to guesswork.
 */
const SORT_HINT =
  'Sort key in dot notation. Common values: media.metadata.title, ' +
  'media.metadata.authorName, media.metadata.publishedYear, media.duration, ' +
  'birthtimeMs, addedAt, size, progress, random.';

export function registerLibraryReadTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'list_libraries',
    {
      title: 'List libraries',
      description:
        'Lists the Audiobookshelf libraries the API key’s user can access, with ' +
        'their id, name and media type (book or podcast). Start here — every ' +
        'other library tool needs a library id.',
      inputSchema: z.object({
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ detail }) =>
      run(async () => {
        const libraries = listFrom(
          await api.get('/api/libraries'),
          'libraries'
        );
        return jsonResult({
          libraries:
            detail === 'full' ? libraries : libraries.map(compactLibrary),
        });
      })
  );

  server.registerTool(
    'get_library',
    {
      title: 'Get library',
      description:
        'Fetches a single library including its folders and scanner settings.',
      inputSchema: z.object({
        library_id: libraryIdParam,
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}`
        );
        const library = (data as { library?: unknown }).library ?? data;
        return jsonResult(
          detail === 'full' ? library : compactLibrary(library)
        );
      })
  );

  server.registerTool(
    'get_library_stats',
    {
      title: 'Get library stats',
      description:
        'Statistics for one library: number of items, authors and genres, total ' +
        'duration and size, longest and largest items.',
      inputSchema: z.object({
        library_id: libraryIdParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id }) =>
      run(async () => {
        const data = await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/stats`
        );
        return jsonResult(data);
      })
  );

  server.registerTool(
    'get_library_filter_data',
    {
      title: 'Get library filter data',
      description:
        'Returns the values that can be filtered on in this library: authors, ' +
        'genres, tags, series, narrators, languages and publishers, each with ' +
        'the id or name to pass to list_library_items as filter_value.',
      inputSchema: z.object({
        library_id: libraryIdParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id }) =>
      run(async () => {
        const data = await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/filterdata`
        );
        return untrustedJsonResult(data);
      })
  );

  server.registerTool(
    'list_library_items',
    {
      title: 'List library items',
      description:
        'Lists items (books or podcasts) of a library, paginated, sortable and ' +
        'filterable. Use get_library_filter_data first to learn the valid ' +
        `filter values. Filter groups — ${describeFilterGroups()}.`,
      inputSchema: z.object({
        library_id: libraryIdParam,
        page: pageParam,
        limit: limitParam(DEFAULT_ITEM_LIMIT),
        sort: z.string().min(1).optional().describe(SORT_HINT),
        descending: z
          .boolean()
          .optional()
          .describe('Reverse the sort order, default false'),
        filter_group: z
          .enum(FILTER_GROUPS as unknown as [string, ...string[]])
          .optional()
          .describe(
            'Filter group. The server encodes group and value into the ' +
              'base64 form its API expects.'
          ),
        filter_value: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Value for filter_group: an id for authors/series, a name for ' +
              'genres/tags/narrators/languages/publishers, one of ' +
              `${PROGRESS_FILTER_VALUES.join('/')} for progress. Must be omitted ` +
              'for the standalone groups.'
          ),
        collapse_series: z
          .boolean()
          .optional()
          .describe('Collapse books of the same series into one entry'),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({
      library_id,
      page,
      limit,
      sort,
      descending,
      filter_group,
      filter_value,
      collapse_series,
      detail,
    }) =>
      run(async () => {
        const effectiveLimit = limit ?? DEFAULT_ITEM_LIMIT;
        const filter =
          filter_group === undefined
            ? undefined
            : encodeFilter(
                filter_group as Parameters<typeof encodeFilter>[0],
                filter_value
              );
        const data = await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/items` +
            query({
              limit: effectiveLimit,
              page: page ?? 0,
              sort,
              desc: descending === true ? 1 : undefined,
              filter,
              // Minified items skip audio files and tracks server-side, which is
              // both faster and much smaller than shaping the full objects here.
              minified: 1,
              collapseseries: collapse_series === true ? 1 : undefined,
            })
        );
        const shaped = compactItemPage(data, detail ?? 'compact');
        const total = typeof shaped.total === 'number' ? shaped.total : 0;
        const currentPage = page ?? 0;
        const seen = (currentPage + 1) * effectiveLimit;
        return untrustedJsonResult({
          ...shaped,
          ...(total > seen
            ? {
                note: `${total} items match — call list_library_items with page=${currentPage + 1} for the next ${effectiveLimit}.`,
              }
            : {}),
        });
      })
  );

  server.registerTool(
    'search_library',
    {
      title: 'Search a library',
      description:
        'Full-text search within one library. Matches books, podcasts, series, ' +
        'authors, narrators and tags. Use this for "do I own X?" questions; use ' +
        'list_library_items with a filter for "show me all X" questions.',
      inputSchema: z.object({
        library_id: libraryIdParam,
        q: z.string().min(1).describe('Search query'),
        limit: limitParam(DEFAULT_SEARCH_LIMIT),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, q, limit, detail }) =>
      run(async () => {
        const data = (await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/search` +
            query({ q, limit: limit ?? DEFAULT_SEARCH_LIMIT })
        )) as Record<string, unknown>;

        if (detail === 'full') return untrustedJsonResult(data);

        // The search response groups matches: book/podcast hits are wrapped in
        // { libraryItem, matchKey, matchText }, the rest are plain entities.
        const wrapped = (key: string): unknown[] =>
          Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
        return untrustedJsonResult({
          book: wrapped('book').map((entry) => {
            const hit = entry as Record<string, unknown>;
            return {
              matchKey: hit.matchKey,
              matchText: hit.matchText,
              libraryItem: compactLibraryItem(hit.libraryItem),
            };
          }),
          podcast: wrapped('podcast').map((entry) => {
            const hit = entry as Record<string, unknown>;
            return {
              matchKey: hit.matchKey,
              matchText: hit.matchText,
              libraryItem: compactLibraryItem(hit.libraryItem),
            };
          }),
          series: wrapped('series').map((entry) => {
            const hit = entry as Record<string, unknown>;
            return compactSeries(hit.series ?? hit);
          }),
          authors: wrapped('authors').map((a) => compactAuthor(a)),
          narrators: wrapped('narrators'),
          tags: wrapped('tags'),
        });
      })
  );

  server.registerTool(
    'get_personalized_shelves',
    {
      title: 'Get personalized shelves',
      description:
        'The shelves of the Audiobookshelf home screen for this user: Continue ' +
        'Listening, Continue Series, Recently Added, Newest Episodes, Listen ' +
        'Again and so on. The fastest answer to "what am I listening to right now?".',
      inputSchema: z.object({
        library_id: libraryIdParam,
        limit: limitParam(10),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, limit, detail }) =>
      run(async () => {
        const data = (await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/personalized` +
            query({ limit: limit ?? 10 })
        )) as unknown[];

        if (detail === 'full') return untrustedJsonResult(data);
        const shelves = Array.isArray(data) ? data : [];
        return untrustedJsonResult(
          shelves.map((entry) => {
            const shelf = entry as Record<string, unknown>;
            const entities = Array.isArray(shelf.entities)
              ? shelf.entities
              : [];
            return {
              id: shelf.id,
              label: shelf.label,
              type: shelf.type,
              // Shelves hold library items, episodes, series or authors
              // depending on `type`; the item projection covers the first two
              // and passes the rest through unchanged.
              entities: entities.map((entity) =>
                shelf.type === 'book' || shelf.type === 'podcast'
                  ? compactLibraryItem(entity)
                  : entity
              ),
            };
          })
        );
      })
  );

  server.registerTool(
    'list_series',
    {
      title: 'List series',
      description:
        'Lists the series of a book library with their number of books and total ' +
        'duration. To list the books of one series, call list_library_items with ' +
        'filter_group="series" and filter_value=<series id>.',
      inputSchema: z.object({
        library_id: libraryIdParam,
        page: pageParam,
        limit: limitParam(DEFAULT_ITEM_LIMIT),
        sort: z
          .string()
          .min(1)
          .optional()
          .describe('Sort key, e.g. name, numBooks, addedAt, totalDuration'),
        descending: z.boolean().optional().describe('Reverse the sort order'),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, page, limit, sort, descending, detail }) =>
      run(async () => {
        const data = (await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/series` +
            query({
              limit: limit ?? DEFAULT_ITEM_LIMIT,
              page: page ?? 0,
              sort,
              desc: descending === true ? 1 : undefined,
              minified: 1,
            })
        )) as Record<string, unknown>;
        const results = listFrom(data, 'series');
        return untrustedJsonResult({
          total: data.total,
          page: data.page,
          limit: data.limit,
          // Without includeBooks: the endpoint embeds every book of every series,
          // which dwarfs the series data itself.
          results:
            detail === 'full' ? results : results.map((s) => compactSeries(s)),
        });
      })
  );

  server.registerTool(
    'get_series',
    {
      title: 'Get series',
      description:
        'Fetches a single series by id, including its books. To list the books ' +
        'with paging and sorting, use list_library_items with ' +
        'filter_group="series" instead.',
      inputSchema: z.object({
        series_id: z.string().min(1).describe('Series id'),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ series_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/series/${assertPathSegment(series_id, 'series_id')}`
        );
        return untrustedJsonResult(
          detail === 'full' ? data : compactSeries(data, { includeBooks: true })
        );
      })
  );

  server.registerTool(
    'list_authors',
    {
      title: 'List authors',
      description:
        'Lists all authors of a book library with their number of books. To list ' +
        'the books of one author, call list_library_items with ' +
        'filter_group="authors" and filter_value=<author id>.',
      inputSchema: z.object({
        library_id: libraryIdParam,
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, detail }) =>
      run(async () => {
        const authors = listFrom(
          await api.get(
            `/api/libraries/${assertPathSegment(library_id, 'library_id')}/authors`
          ),
          'authors'
        );
        return untrustedJsonResult({
          numAuthors: authors.length,
          authors:
            detail === 'full' ? authors : authors.map((a) => compactAuthor(a)),
        });
      })
  );

  server.registerTool(
    'get_author',
    {
      title: 'Get author',
      description:
        'Fetches a single author, optionally with the library items attributed ' +
        'to them.',
      inputSchema: z.object({
        author_id: z.string().min(1).describe('Author id'),
        include_items: z
          .boolean()
          .optional()
          .describe('Also return the author’s library items, default false'),
        library_id: z
          .string()
          .min(1)
          .optional()
          .describe('Restrict the returned items to this library'),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ author_id, include_items, library_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/authors/${assertPathSegment(author_id, 'author_id')}` +
            query({
              include: include_items === true ? 'items' : undefined,
              library:
                library_id === undefined
                  ? undefined
                  : assertPathSegment(library_id, 'library_id'),
            })
        );
        return untrustedJsonResult(
          detail === 'full'
            ? data
            : compactAuthor(data, { includeDescription: true })
        );
      })
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description:
        'Lists all tags used on the server, across libraries. Tags are the ' +
        'user-defined labels on library items.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => untrustedJsonResult(await api.get('/api/tags')))
  );

  server.registerTool(
    'list_genres',
    {
      title: 'List genres',
      description:
        'Lists all genres used on the server, across libraries. Genres come from ' +
        'the media metadata, not from the user.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => untrustedJsonResult(await api.get('/api/genres')))
  );

  server.registerTool(
    'get_server_status',
    {
      title: 'Get server status',
      description:
        'Version and initialization state of the Audiobookshelf server. Useful ' +
        'to check connectivity and whether the server is new enough for API keys ' +
        '(2.26.0 or later).',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => jsonResult(await api.get('/status')))
  );
}
