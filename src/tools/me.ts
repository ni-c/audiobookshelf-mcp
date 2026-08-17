import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { assertPathSegment, query, type AudiobookshelfApi } from '../api.js';
import { jsonResult, run, untrustedJsonResult } from '../result.js';
import {
  detailParam,
  libraryItemIdParam,
  limitParam,
  pageParam,
} from '../schema.js';
import {
  compactBookmark,
  compactLibraryItem,
  compactListeningSession,
  compactMediaProgress,
  compactUser,
  listFrom,
} from '../shape.js';

const EPISODE_ID_DESCRIPTION =
  'Podcast episode id — required for podcast episodes, omitted for books';

export function registerMeReadTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'get_me',
    {
      title: 'Get the current user',
      description:
        'Returns the Audiobookshelf user the API key acts on behalf of, with ' +
        'their permissions and accessible libraries. The compact projection ' +
        'reports media progress and bookmarks as counts — the full user object ' +
        'embeds every single one of them.',
      inputSchema: {
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ detail }) =>
      run(async () => {
        const data = await api.get('/api/me');
        return jsonResult(detail === 'full' ? data : compactUser(data));
      })
  );

  server.registerTool(
    'list_items_in_progress',
    {
      title: 'List items in progress',
      description:
        'The items the user has started but not finished, newest first — the ' +
        '"Continue Listening" list across all libraries.',
      inputSchema: {
        limit: limitParam(25),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/me/items-in-progress${query({ limit: limit ?? 25 })}`
        );
        const items = listFrom(data, 'libraryItems');
        return untrustedJsonResult({
          numReturned: items.length,
          libraryItems:
            detail === 'full' ? items : items.map((i) => compactLibraryItem(i)),
        });
      })
  );

  server.registerTool(
    'get_media_progress',
    {
      title: 'Get media progress',
      description:
        'The listening progress of the current user for one book or podcast ' +
        'episode: position, percentage and whether it is finished. Returns a 404 ' +
        'error when the item has never been started.',
      inputSchema: {
        library_item_id: libraryItemIdParam,
        episode_id: z
          .string()
          .min(1)
          .optional()
          .describe(EPISODE_ID_DESCRIPTION),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_item_id, episode_id, detail }) =>
      run(async () => {
        const path =
          `/api/me/progress/${assertPathSegment(library_item_id, 'library_item_id')}` +
          (episode_id === undefined
            ? ''
            : `/${assertPathSegment(episode_id, 'episode_id')}`);
        const data = await api.get(path);
        return jsonResult(
          detail === 'full' ? data : compactMediaProgress(data)
        );
      })
  );

  server.registerTool(
    'get_listening_stats',
    {
      title: 'Get listening stats',
      description:
        'Aggregated listening statistics of the current user: total time, time ' +
        'per day, time per weekday and the most listened items.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () =>
        untrustedJsonResult(await api.get('/api/me/listening-stats'))
      )
  );

  server.registerTool(
    'get_year_stats',
    {
      title: 'Get stats for a year',
      description:
        'The "year in review" statistics of the current user for one calendar ' +
        'year: books finished, time listened, top authors and genres.',
      inputSchema: {
        year: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .describe('Calendar year, e.g. 2026'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ year }) =>
      run(async () =>
        untrustedJsonResult(await api.get(`/api/me/stats/year/${year}`))
      )
  );

  server.registerTool(
    'list_listening_sessions',
    {
      title: 'List listening sessions',
      description:
        'The playback sessions of the current user, newest first — each entry is ' +
        'one listening stretch with device, position and time listened.',
      inputSchema: {
        page: pageParam,
        limit: limitParam(10),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ page, limit, detail }) =>
      run(async () => {
        const data = (await api.get(
          '/api/me/listening-sessions' +
            query({ page: page ?? 0, itemsPerPage: limit ?? 10 })
        )) as Record<string, unknown>;
        const sessions = listFrom(data, 'sessions');
        return untrustedJsonResult({
          total: data.total,
          numPages: data.numPages,
          page: data.page,
          sessions:
            detail === 'full'
              ? sessions
              : sessions.map(compactListeningSession),
        });
      })
  );

  server.registerTool(
    'list_bookmarks',
    {
      title: 'List bookmarks',
      description:
        'The bookmarks of the current user — either all of them, or those of one ' +
        'library item. A bookmark is a named position in seconds.',
      inputSchema: {
        library_item_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Restrict the result to the bookmarks of this library item'
          ),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_item_id, detail }) =>
      run(async () => {
        const path =
          library_item_id === undefined
            ? '/api/me/bookmarks'
            : `/api/me/bookmarks/${assertPathSegment(library_item_id, 'library_item_id')}`;
        const data = await api.get(path);
        const bookmarks = listFrom(data, 'bookmarks');
        return untrustedJsonResult({
          numBookmarks: bookmarks.length,
          bookmarks:
            detail === 'full' ? bookmarks : bookmarks.map(compactBookmark),
        });
      })
  );
}
