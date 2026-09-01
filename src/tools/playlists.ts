import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { setResourceKey } from 'mcp-approval';
import type { Approver, ConfirmationStore } from 'mcp-approval';
import {
  errorResult,
  run,
  textResult,
  untrustedJsonResult,
} from '../result.js';

import { assertPathSegment, type AudiobookshelfApi } from '../api.js';
import { confirmTokenParam, detailParam } from '../schema.js';
import { compactPlaylist, listFrom } from '../shape.js';

const playlistIdParam = z
  .string()
  .min(1)
  .describe('Playlist id, as returned by list_playlists');

/**
 * Audiobookshelf keeps playlists homogeneous: either every entry carries an
 * episode_id (podcast playlist) or none does (book playlist). A mixed list is
 * rejected with HTTP 400.
 */
const playlistItemsParam = z
  .array(
    z.object({
      library_item_id: z.string().min(1).describe('Library item id'),
      episode_id: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Podcast episode id — required for podcast playlists, must be omitted ' +
            'for book playlists'
        ),
    })
  )
  .max(500);

type PlaylistItemInput = {
  library_item_id: string;
  episode_id?: string | undefined;
};

function toApiItems(items: PlaylistItemInput[]): Record<string, string>[] {
  return items.map((item) => ({
    libraryItemId: assertPathSegment(item.library_item_id, 'library_item_id'),
    ...(item.episode_id !== undefined
      ? { episodeId: assertPathSegment(item.episode_id, 'episode_id') }
      : {}),
  }));
}

export function registerPlaylistReadTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'list_playlists',
    {
      title: 'List playlists',
      description:
        'Lists the playlists of the API key’s user. Without library_id it returns ' +
        'the playlists of every accessible library. Playlists are private per ' +
        'user and can hold books or podcast episodes; collections are shared ' +
        'server-wide and hold books only.',
      inputSchema: z.object({
        library_id: z
          .string()
          .min(1)
          .optional()
          .describe('Restrict the result to this library'),
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ library_id, detail }) =>
      run(async () => {
        const path =
          library_id === undefined
            ? '/api/playlists'
            : `/api/libraries/${assertPathSegment(library_id, 'library_id')}/playlists`;
        const playlists = listFrom(await api.get(path), 'playlists');
        return untrustedJsonResult({
          numPlaylists: playlists.length,
          playlists:
            detail === 'full' ? playlists : playlists.map(compactPlaylist),
        });
      })
  );

  server.registerTool(
    'get_playlist',
    {
      title: 'Get playlist',
      description: 'Fetches one playlist with its entries, in order.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        detail: detailParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ playlist_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/playlists/${assertPathSegment(playlist_id, 'playlist_id')}`
        );
        return untrustedJsonResult(
          detail === 'full' ? data : compactPlaylist(data)
        );
      })
  );
}

export function registerPlaylistWriteTools(
  server: McpServer,
  api: AudiobookshelfApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'create_playlist',
    {
      title: 'Create playlist',
      description:
        'Creates a playlist for the API key’s user. Unlike a collection it may ' +
        'start out empty and it may hold podcast episodes.',
      inputSchema: z.object({
        library_id: z
          .string()
          .min(1)
          .describe('Library the playlist belongs to'),
        name: z.string().min(1).max(255).describe('Playlist name'),
        description: z
          .string()
          .max(4000)
          .optional()
          .describe('Optional description'),
        items: playlistItemsParam
          .optional()
          .describe('Initial entries, optional'),
      }),
    },
    async ({ library_id, name, description, items }) =>
      run(async () => {
        const created = await api.post('/api/playlists', {
          libraryId: assertPathSegment(library_id, 'library_id'),
          name,
          ...(description !== undefined ? { description } : {}),
          items: items === undefined ? [] : toApiItems(items),
        });
        return untrustedJsonResult(compactPlaylist(created));
      })
  );

  server.registerTool(
    'update_playlist',
    {
      title: 'Update playlist',
      description:
        'Renames a playlist, changes its description or reorders its entries. ' +
        'items replaces the order completely, so it has to contain every entry ' +
        'that should stay — use add_items_to_playlist and ' +
        'remove_items_from_playlist to change membership. The library of a ' +
        'playlist cannot be changed.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        name: z.string().min(1).max(255).optional().describe('New name'),
        description: z
          .string()
          .max(4000)
          .optional()
          .describe('New description'),
        items: playlistItemsParam
          .optional()
          .describe('Complete, newly ordered list of entries'),
      }),
    },
    async ({ playlist_id, name, description, items }) =>
      run(async () => {
        if (
          name === undefined &&
          description === undefined &&
          items === undefined
        ) {
          return errorResult(
            'Nothing to update: pass name, description or items.'
          );
        }
        const updated = await api.patch(
          `/api/playlists/${assertPathSegment(playlist_id, 'playlist_id')}`,
          {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(items !== undefined ? { items: toApiItems(items) } : {}),
          }
        );
        return untrustedJsonResult(compactPlaylist(updated));
      })
  );

  server.registerTool(
    'add_items_to_playlist',
    {
      title: 'Add items to playlist',
      description:
        'Appends books or podcast episodes to a playlist. All entries must come ' +
        'from the playlist’s library and match its kind — a podcast playlist ' +
        'needs an episode_id on every entry, a book playlist on none.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        items: playlistItemsParam.min(1),
      }),
    },
    async ({ playlist_id, items }) =>
      run(async () => {
        const updated = await api.post(
          `/api/playlists/${assertPathSegment(playlist_id, 'playlist_id')}/batch/add`,
          { items: toApiItems(items) }
        );
        return untrustedJsonResult(compactPlaylist(updated));
      })
  );

  server.registerTool(
    'remove_items_from_playlist',
    {
      title: 'Remove items from playlist',
      description:
        'Removes entries from a playlist. The media itself is untouched and the ' +
        'entries can be added back with add_items_to_playlist. Note that ' +
        'Audiobookshelf deletes a playlist automatically once its last entry is ' +
        'removed.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        items: playlistItemsParam.min(1),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ playlist_id, items }) =>
      run(async () => {
        const updated = await api.post(
          `/api/playlists/${assertPathSegment(playlist_id, 'playlist_id')}/batch/remove`,
          { items: toApiItems(items) }
        );
        const shaped = compactPlaylist(updated);
        // The API answers with the playlist as it was, so an emptied playlist is
        // only recognizable by its item count — say so instead of returning
        // something that looks like an ordinary update.
        return untrustedJsonResult(
          shaped.numItems === 0
            ? {
                ...shaped,
                note:
                  'The playlist has no entries left and was therefore deleted by ' +
                  'Audiobookshelf. It cannot be restored — recreate it with ' +
                  'create_playlist.',
              }
            : shaped
        );
      })
  );

  server.registerTool(
    'delete_playlist',
    {
      title: 'Delete playlist',
      description:
        'Deletes a playlist. The media stays in the library. Two-step: the first ' +
        'call returns a confirmation token, the second call with that token ' +
        'performs the deletion.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ playlist_id, confirm_token }, mcp) =>
      run(async () => {
        const safeId = assertPathSegment(playlist_id, 'playlist_id');
        const resource = setResourceKey('delete_playlist', [safeId]);

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete playlist ${safeId}`,
            consequence:
              'The playlist cannot be restored from here. The items it held are ' +
              'not deleted.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_playlist',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A token that was sent and did not match is refused with the reason
        // rather than answered with a fresh prompt; the sentence is the
        // library's, so every server refuses in the same words.
        if (outcome.decision === 'rejected') {
          return errorResult(outcome.reason);
        }
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. delete_playlist did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;

        await api.delete(`/api/playlists/${safeId}`);
        return textResult(`Playlist ${safeId} deleted.`);
      })
  );
}
