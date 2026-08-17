import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { assertPathSegment, query, type AudiobookshelfApi } from '../api.js';
import { errorResult, run, untrustedJsonResult } from '../result.js';
import { detailParam, libraryItemIdParam } from '../schema.js';
import {
  compactLibraryItem,
  compactPodcastEpisode,
  truncateText,
} from '../shape.js';

export function registerItemReadTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'get_library_item',
    {
      title: 'Get library item',
      description:
        'Fetches one book or podcast including its metadata, tags and the ' +
        'listening progress of the API key’s user. Chapters, audio files and ' +
        'tracks are not part of the compact projection — use get_item_chapters ' +
        'for chapters, or detail="full" for everything.',
      inputSchema: {
        library_item_id: libraryItemIdParam,
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_item_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/items/${assertPathSegment(library_item_id, 'library_item_id')}` +
            // include=progress is only honoured together with expanded=1.
            query({ expanded: 1, include: 'progress' })
        );
        return untrustedJsonResult(
          detail === 'full'
            ? data
            : compactLibraryItem(data, { includeDescription: true })
        );
      })
  );

  server.registerTool(
    'get_item_chapters',
    {
      title: 'Get item chapters',
      description:
        'Returns the chapter list of a book with start and end times in seconds. ' +
        'Separate from get_library_item because long audiobooks can have hundreds ' +
        'of chapters.',
      inputSchema: {
        library_item_id: libraryItemIdParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_item_id }) =>
      run(async () => {
        const safeId = assertPathSegment(library_item_id, 'library_item_id');
        const item = (await api.get(
          `/api/items/${safeId}` + query({ expanded: 1 })
        )) as Record<string, unknown>;
        const media = (item.media ?? {}) as Record<string, unknown>;
        const chapters = Array.isArray(media.chapters) ? media.chapters : [];
        if (item.mediaType !== 'book') {
          return errorResult(
            `Library item ${safeId} is a ${String(item.mediaType)}, not a book — ` +
              'only books have chapters. For podcast episodes use get_podcast_episode.'
          );
        }
        return untrustedJsonResult({
          libraryItemId: safeId,
          numChapters: chapters.length,
          chapters,
        });
      })
  );

  server.registerTool(
    'get_podcast_episode',
    {
      title: 'Get podcast episode',
      description:
        'Fetches one podcast episode with its publication date, duration and ' +
        'description.',
      inputSchema: {
        library_item_id: z
          .string()
          .min(1)
          .describe('Library item id of the podcast the episode belongs to'),
        episode_id: z.string().min(1).describe('Podcast episode id'),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_item_id, episode_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/podcasts/${assertPathSegment(library_item_id, 'library_item_id')}` +
            `/episode/${assertPathSegment(episode_id, 'episode_id')}`
        );
        return untrustedJsonResult(
          detail === 'full'
            ? data
            : compactPodcastEpisode(data, { includeDescription: true })
        );
      })
  );

  server.registerTool(
    'list_recent_episodes',
    {
      title: 'List recent podcast episodes',
      description:
        'Lists the most recently published episodes across a podcast library — ' +
        'the "Newest Episodes" view. Only works on libraries with mediaType ' +
        '"podcast".',
      inputSchema: {
        library_id: z.string().min(1).describe('Id of a podcast library'),
        page: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based page number, default 0'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Episodes per page, default 25, max 100'),
        detail: detailParam,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, page, limit, detail }) =>
      run(async () => {
        const data = (await api.get(
          `/api/libraries/${assertPathSegment(library_id, 'library_id')}/recent-episodes` +
            query({ limit: limit ?? 25, page: page ?? 0 })
        )) as Record<string, unknown>;
        const episodes = Array.isArray(data.episodes) ? data.episodes : [];
        return untrustedJsonResult({
          total: data.total,
          limit: data.limit,
          page: data.page,
          episodes:
            detail === 'full'
              ? episodes
              : episodes.map((episode) => {
                  const shaped = compactPodcastEpisode(episode);
                  const podcast = (episode as Record<string, unknown>).podcast;
                  return podcast === undefined
                    ? shaped
                    : {
                        ...shaped,
                        podcastTitle: truncateText(
                          (
                            (podcast as Record<string, unknown>).metadata as
                              Record<string, unknown> | undefined
                          )?.title,
                          200
                        ),
                      };
                }),
        });
      })
  );
}
