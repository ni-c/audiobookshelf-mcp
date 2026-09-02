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
import { READ_ONLY } from './annotations.js';
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
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
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
      annotations: {
        // Additive. Not idempotent: a second call makes a second playlist.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        'Renames a playlist, changes its description or reorders its entries.\n\n' +
        'items ONLY REORDERS. It cannot add or remove anything, and it must ' +
        'contain EXACTLY the entries the playlist already has: Audiobookshelf ' +
        'refuses a list of a different length with HTTP 400 "Invalid playlist ' +
        'items. Length mismatch". Read the current entries with get_playlist ' +
        'first, then send them in the order you want. Use ' +
        'add_items_to_playlist and remove_items_from_playlist to change ' +
        'membership. The library of a playlist cannot be changed.\n\n' +
        'Reordering asks a person first, because the order somebody arranged ' +
        'cannot be reconstructed afterwards; renaming and re-describing do ' +
        'not. Where the client cannot show a dialog, call once to receive a ' +
        'token and again with it.',
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
          .describe(
            'Exactly the entries the playlist already has, in the order you ' +
              'want them. Reorders only; a list of a different length is ' +
              'refused with HTTP 400.'
          ),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Replaces a name and description somebody typed, with no history.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ playlist_id, name, description, items, confirm_token }, mcp) =>
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
        const safePlaylist = assertPathSegment(playlist_id, 'playlist_id');
        const entries = items === undefined ? undefined : toApiItems(items);

        // The gate hangs off the *effect*, not off the verb — see the longer
        // note in `update_collection`. Measured against 2.29.0, `items` is a
        // reorder and nothing else: the controller refuses a list whose length
        // differs from the playlist's with `400 Invalid playlist items. Length
        // mismatch`, so this cannot drop an entry even in principle. What it
        // does replace is the order somebody arranged, which is what
        // `remove_items_from_playlist` names as its own reason for asking.
        if (entries !== undefined) {
          const outcome = await approval.requestApproval(
            server,
            mcp,
            confirmations,
            {
              // Ids only: a playlist name is user-controlled content and this
              // string is read by a model as well as by a person.
              what: `reorder the ${entries.length} entries of playlist ${safePlaylist}`,
              consequence:
                'The order somebody arranged is replaced and cannot be ' +
                'reconstructed from here. Nothing leaves the playlist: ' +
                'Audiobookshelf refuses a list that is not exactly the current ' +
                'entries.',
              // Each target carries its position. `setResourceKey` sorts its
              // list before fingerprinting, so an unprefixed list would give
              // [A, B] and [B, A] the same key — and the order *is* the change
              // this tool makes.
              resourceKey: setResourceKey('update_playlist:items', [
                `playlist:${safePlaylist}`,
                ...entries.map(
                  (entry, index) =>
                    `${index}:${String(entry.libraryItemId)}/${String(entry.episodeId ?? '')}`
                ),
              ]),
              token: confirm_token,
              toolName: 'update_playlist',
              hint: 'Tick to go ahead, leave it to cancel.',
            }
          );
          if (outcome.decision === 'rejected')
            return errorResult(outcome.reason);
          if (outcome.decision === 'declined') {
            return errorResult(
              'The user declined. update_playlist did nothing.'
            );
          }
          if (outcome.decision === 'pending') return outcome.result;
        }

        const updated = await api.patch(`/api/playlists/${safePlaylist}`, {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(entries !== undefined ? { items: entries } : {}),
        });
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
      annotations: {
        // Additive, and unlike a collection a playlist is an ordered list:
        // adding the same item twice leaves it in twice.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        'removed. Asks a person first; where the client cannot show a dialog, ' +
        'call once to receive a token and again with it.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        items: playlistItemsParam.min(1),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent: removing an item that is already out leaves the same
        // playlist.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ playlist_id, items, confirm_token }, mcp) =>
      run(async () => {
        const safeId = assertPathSegment(playlist_id, 'playlist_id');
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            // Ids only: a playlist name is user-controlled content and this
            // string is read by a model as well as by a person.
            what: `remove ${items.length} entr${items.length === 1 ? 'y' : 'ies'} from playlist ${safeId}`,
            consequence:
              'Audiobookshelf deletes a playlist outright once its last entry ' +
              'is removed, and a deleted playlist cannot be restored. Where ' +
              'entries remain, adding them back appends them at the end — the ' +
              'order is not recoverable from here.',
            resourceKey: setResourceKey('remove_items_from_playlist', [
              safeId,
              ...items.map((item) => JSON.stringify(item)),
            ]),
            token: confirm_token,
            toolName: 'remove_items_from_playlist',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(
            'The user declined. remove_items_from_playlist did nothing.'
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        const updated = await api.post(
          `/api/playlists/${safeId}/batch/remove`,
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
        'Deletes a playlist. The media stays in the library. ' +
        'Asks a person first; where the client cannot show a dialog, call once ' +
        'to receive a token and again with it.',
      inputSchema: z.object({
        playlist_id: playlistIdParam,
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent by the specification's wording.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
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

        // Answers `200 text/plain "OK"`, not a document.
        await api.delete(`/api/playlists/${safeId}`, { text: true });
        return textResult(`Playlist ${safeId} deleted.`);
      })
  );
}
