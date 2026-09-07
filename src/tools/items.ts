import { z } from 'zod';
import { marked, record } from '../output-schema.js';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  asRecord,
  compactLibraryItem,
  compactPodcastEpisode,
  finiteNumber,
  objectsOf,
  truncateText,
} from '../shape.js';
import { quoted } from '../clean.js';

import { assertPathSegment, query, type AudiobookshelfApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { errorResult, run, untrustedJsonResult } from '../result.js';
import {
  detailParam,
  idParam,
  libraryItemIdParam,
  limitParam,
  pageParam,
} from '../schema.js';

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
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked(),
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
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked({ chapters: z.array(record) }),
    },
    async ({ library_item_id }) =>
      run(async () => {
        const safeId = assertPathSegment(library_item_id, 'library_item_id');
        const item = asRecord(
          await api.get(`/api/items/${safeId}` + query({ expanded: 1 }))
        );
        const media = asRecord(item.media);
        // Objects only: the schema promises `chapters: z.array(record)`, and a
        // single `null` among them failed the whole answer, chapters included.
        const chapters = objectsOf(media.chapters);
        if (item.mediaType !== 'book') {
          // `quoted`, because this is the instance's string in a sentence the
          // model reads: it can be a megabyte long and carry an escape
          // sequence, and `String(…)` alone said neither. And a media type
          // that is missing entirely is its own sentence — "is a undefined"
          // read as a bug in this server rather than as an unusable answer
          // from the instance.
          return errorResult(
            typeof item.mediaType === 'string'
              ? `Library item ${safeId} is a ${quoted(item.mediaType)}, not a book — ` +
                  'only books have chapters. For podcast episodes use get_podcast_episode.'
              : `Audiobookshelf did not say what kind of item ${safeId} is, so ` +
                  'its chapters cannot be read. The answer carried no mediaType ' +
                  'at all — check that the id exists and that the API key’s user ' +
                  'can see it.'
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
      inputSchema: z.object({
        library_item_id: idParam(
          'Library item id of the podcast the episode belongs to'
        ),
        episode_id: idParam('Podcast episode id'),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked(),
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
      inputSchema: z.object({
        library_id: idParam('Id of a podcast library'),
        page: pageParam,
        limit: limitParam(25),
        detail: detailParam,
      }),
      annotations: READ_ONLY,
      outputSchema: marked(),
    },
    async ({ library_id, page, limit, detail }) =>
      run(async () => {
        const data = asRecord(
          await api.get(
            `/api/libraries/${assertPathSegment(library_id, 'library_id')}/recent-episodes` +
              query({ limit: limit ?? 25, page: page ?? 0 })
          )
        );
        const episodes = Array.isArray(data.episodes) ? data.episodes : [];
        return untrustedJsonResult({
          // This endpoint reports no total, only the page it returned.
          numReturned: episodes.length,
          limit: finiteNumber(data.limit),
          page: finiteNumber(data.page),
          episodes:
            detail === 'full'
              ? objectsOf(episodes)
              : episodes.map((episode) => {
                  const shaped = compactPodcastEpisode(episode);
                  const podcast = asRecord(episode).podcast;
                  return podcast === undefined
                    ? shaped
                    : {
                        ...shaped,
                        podcastTitle: truncateText(
                          asRecord(asRecord(podcast).metadata).title,
                          200
                        ),
                      };
                }),
        });
      })
  );
}
