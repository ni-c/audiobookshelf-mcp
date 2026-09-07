import { z } from 'zod';
import { marked, plain, record } from '../output-schema.js';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  detailParam,
  idParam,
  libraryItemIdParam,
  limitParam,
  pageParam,
} from '../schema.js';
import {
  asRecord,
  compactBookmark,
  compactLibraryItem,
  compactListeningSession,
  compactListeningStats,
  compactMediaProgress,
  compactUser,
  finiteNumber,
  listFrom,
  objectsOf,
} from '../shape.js';
import { redactCredentials } from '../clean.js';

import { assertPathSegment, query, type AudiobookshelfApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { jsonResult, run, untrustedJsonResult } from '../result.js';

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
        'embeds every single one of them. Credential fields are removed from ' +
        'both projections.',
      inputSchema: z.object({
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked({ credentials_removed: z.array(z.string()) }),
    },
    async ({ detail }) =>
      run(async () => {
        const data = await api.get('/api/me');
        // `GET /api/me` answers with `User.toOldJSONForBrowser()`, and
        // `MeController.getCurrentUser` calls it without `hideRootToken` — so
        // the document carries `token`, the account's old non-expiring access
        // token, for a root account included. The compact projection never
        // named the field; `detail: "full"` handed the record on whole, which
        // put a credential that outlives this process into a model's context.
        //
        // Redacted rather than projected around: the API is not this server's
        // to promise, and the next release is free to add a second one.
        const { value, report } = redactCredentials(data);
        return untrustedJsonResult({
          ...(detail === 'full'
            ? asRecord(value)
            : compactUser(asRecord(value))),
          credentials_removed: report.removed,
        });
      })
  );

  server.registerTool(
    'list_items_in_progress',
    {
      title: 'List items in progress',
      description:
        'The items the user has started but not finished, newest first — the ' +
        '"Continue Listening" list across all libraries. The entries carry ' +
        'progressLastUpdate but not the position itself; use get_media_progress ' +
        'for that. For podcasts, recentEpisode names the episode in progress.',
      inputSchema: z.object({
        limit: limitParam(25),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked({
        numReturned: z.number().int(),
        libraryItems: z.array(record),
      }),
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
            detail === 'full'
              ? objectsOf(items)
              : items.map((i) => compactLibraryItem(i)),
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
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        episode_id: idParam(EPISODE_ID_DESCRIPTION).optional(),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: plain(),
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
        'per weekday, the last 30 days, the ten most listened items and the ten ' +
        'most recent sessions. detail="full" returns the complete per-day history ' +
        'and the full metadata of every item ever listened to, which is the ' +
        'largest response this API produces.',
      inputSchema: z.object({
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked(),
    },
    async ({ detail }) =>
      run(async () => {
        const data = await api.get('/api/me/listening-stats');
        return untrustedJsonResult(
          detail === 'full' ? data : compactListeningStats(data)
        );
      })
  );

  server.registerTool(
    'get_year_stats',
    {
      title: 'Get stats for a year',
      description:
        'The "year in review" statistics of the current user for one calendar ' +
        'year: books finished, time listened, top authors and genres.',
      inputSchema: z.object({
        year: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .describe('Calendar year, e.g. 2026'),
      }),
      annotations: READ_ONLY,
      outputSchema: marked(),
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
      inputSchema: z.object({
        page: pageParam,
        limit: limitParam(10),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked({ sessions: z.array(record) }),
    },
    async ({ page, limit, detail }) =>
      run(async () => {
        const data = asRecord(
          await api.get(
            '/api/me/listening-sessions' +
              query({ page: page ?? 0, itemsPerPage: limit ?? 10 })
          )
        );
        const sessions = listFrom(data, 'sessions');
        return untrustedJsonResult({
          total: finiteNumber(data.total),
          numPages: finiteNumber(data.numPages),
          page: finiteNumber(data.page),
          sessions:
            detail === 'full'
              ? objectsOf(sessions)
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
        'library item. A bookmark is a named position in seconds.\n\n' +
        'Audiobookshelf has no bookmarks endpoint: they are a field on the ' +
        'account, so this reads /api/me and filters here. That is why there is ' +
        'no pagination — you get all of them.',
      inputSchema: z.object({
        library_item_id: idParam(
          'Restrict the result to the bookmarks of this library item'
        ).optional(),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked({ bookmarks: z.array(record) }),
    },
    async ({ library_item_id, detail }) =>
      run(async () => {
        // `/api/me/bookmarks` does not exist — verified against 2.29.0, it is
        // a 404 whether or not an item id follows it. Bookmarks are a field on
        // the account object, so the filtering happens here.
        // The same endpoint `get_me` reads, and the same reason to redact:
        // this tool only projects the bookmarks, but `detail: "full"` hands
        // the entries on as they came and the record they came from carries
        // the account's access token two keys away.
        const data = redactCredentials(await api.get('/api/me')).value;
        const all = listFrom(data, 'bookmarks');
        const bookmarks =
          library_item_id === undefined
            ? all
            : all.filter(
                (bookmark) =>
                  asRecord(bookmark).libraryItemId === library_item_id
              );
        return untrustedJsonResult({
          numBookmarks: bookmarks.length,
          bookmarks:
            detail === 'full'
              ? objectsOf(bookmarks)
              : bookmarks.map(compactBookmark),
        });
      })
  );
}
