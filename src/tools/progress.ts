import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { setResourceKey } from 'mcp-approval';
import type { Approver, ConfirmationStore } from 'mcp-approval';

import { assertPathSegment, type AudiobookshelfApi } from '../api.js';
import { errorResult, run, textResult } from '../result.js';
import { confirmTokenParam, libraryItemIdParam } from '../schema.js';

const episodeIdParam = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Podcast episode id — required to address a podcast episode, omitted for books'
  );

export function registerProgressWriteTools(
  server: McpServer,
  api: AudiobookshelfApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'set_media_progress',
    {
      title: 'Set media progress',
      description:
        'Creates or updates the listening progress of the API key’s user for one ' +
        'book or podcast episode. Set is_finished=true to mark it as finished, ' +
        'is_finished=false to reopen it (which resets the position to 0), or ' +
        'current_time to jump to a position in seconds. Audiobookshelf also marks ' +
        'an item finished on its own once less than ten seconds remain.',
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        episode_id: episodeIdParam,
        current_time: z
          .number()
          .min(0)
          .optional()
          .describe('New playback position in seconds'),
        progress: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'Progress as a fraction between 0 and 1. Only used when is_finished ' +
              'is not given.'
          ),
        is_finished: z
          .boolean()
          .optional()
          .describe('Mark the item as finished (true) or unfinished (false)'),
        hide_from_continue_listening: z
          .boolean()
          .optional()
          .describe(
            'Hide the item from the "Continue Listening" shelf without changing ' +
              'its position'
          ),
      }),
    },
    async ({
      library_item_id,
      episode_id,
      current_time,
      progress,
      is_finished,
      hide_from_continue_listening,
    }) =>
      run(async () => {
        if (
          current_time === undefined &&
          progress === undefined &&
          is_finished === undefined &&
          hide_from_continue_listening === undefined
        ) {
          return errorResult(
            'Nothing to update: pass current_time, progress, is_finished or ' +
              'hide_from_continue_listening.'
          );
        }

        const safeItemId = assertPathSegment(
          library_item_id,
          'library_item_id'
        );
        const path =
          `/api/me/progress/${safeItemId}` +
          (episode_id === undefined
            ? ''
            : `/${assertPathSegment(episode_id, 'episode_id')}`);

        // Only the fields below are forwarded. The endpoint applies its payload
        // to the progress record wholesale, so passing arbitrary keys through
        // would let a caller write columns this tool never intended to touch.
        await api.patch(path, {
          ...(current_time !== undefined ? { currentTime: current_time } : {}),
          ...(progress !== undefined ? { progress } : {}),
          ...(is_finished !== undefined ? { isFinished: is_finished } : {}),
          ...(hide_from_continue_listening !== undefined
            ? { hideFromContinueListening: hide_from_continue_listening }
            : {}),
        });

        // The endpoint answers with 200 and no body; read the result back so the
        // model sees the state that actually got stored.
        const updated = await api.get(path);
        return textResult(
          `Progress updated.\n${JSON.stringify(updated, null, 2)}`
        );
      })
  );

  server.registerTool(
    'delete_media_progress',
    {
      title: 'Delete media progress',
      description:
        'Deletes a progress record of the API key’s user, which removes the ' +
        'listening history for that item — position, finished state and dates. ' +
        'Takes the media progress id (field "id" of get_media_progress), not the ' +
        'library item id. Two-step: the first call returns a confirmation token, ' +
        'the second call with that token performs the deletion.',
      inputSchema: z.object({
        media_progress_id: z
          .string()
          .min(1)
          .describe(
            'Media progress id, from the "id" field of get_media_progress'
          ),
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ media_progress_id, confirm_token }, mcp) =>
      run(async () => {
        const safeId = assertPathSegment(
          media_progress_id,
          'media_progress_id'
        );
        const resource = setResourceKey('delete_media_progress', [safeId]);

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete the listening history of media progress ${safeId}`,
            consequence:
              'The saved position and listening history for that item are lost.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_media_progress',
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
          return errorResult(
            `The user declined. delete_media_progress did nothing.`
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        await api.delete(`/api/me/progress/${safeId}`);
        return textResult(`Media progress ${safeId} deleted.`);
      })
  );
}

export function registerBookmarkWriteTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'create_bookmark',
    {
      title: 'Create bookmark',
      description:
        'Creates a bookmark at a position of a book for the API key’s user. The ' +
        'position in seconds is the bookmark’s identity — a second bookmark at ' +
        'the same second is rejected.',
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        time: z
          .number()
          .min(0)
          .describe('Position in seconds where the bookmark is placed'),
        title: z.string().min(1).max(255).describe('Bookmark title'),
      }),
    },
    async ({ library_item_id, time, title }) =>
      run(async () => {
        const created = await api.post(
          `/api/me/item/${assertPathSegment(library_item_id, 'library_item_id')}/bookmark`,
          { time, title }
        );
        return textResult(
          `Bookmark created.\n${JSON.stringify(created, null, 2)}`
        );
      })
  );

  server.registerTool(
    'update_bookmark',
    {
      title: 'Update bookmark',
      description:
        'Renames the bookmark at a given position. The position itself cannot be ' +
        'changed — delete the bookmark and create a new one for that.',
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        time: z
          .number()
          .min(0)
          .describe('Position in seconds identifying the bookmark'),
        title: z.string().min(1).max(255).describe('New bookmark title'),
      }),
    },
    async ({ library_item_id, time, title }) =>
      run(async () => {
        const updated = await api.patch(
          `/api/me/item/${assertPathSegment(library_item_id, 'library_item_id')}/bookmark`,
          { time, title }
        );
        return textResult(
          `Bookmark updated.\n${JSON.stringify(updated, null, 2)}`
        );
      })
  );

  server.registerTool(
    'delete_bookmark',
    {
      title: 'Delete bookmark',
      description:
        'Deletes the bookmark at a given position. No confirmation token: a ' +
        'bookmark is a position and a title, and create_bookmark restores it.',
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        time: z
          .number()
          .min(0)
          .describe('Position in seconds identifying the bookmark'),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ library_item_id, time }) =>
      run(async () => {
        const safeId = assertPathSegment(library_item_id, 'library_item_id');
        // The position goes into the path, so it must be a finite number and
        // never a string that could carry path segments.
        if (!Number.isFinite(time)) {
          throw new Error('invalid time: must be a finite number of seconds');
        }
        await api.delete(`/api/me/item/${safeId}/bookmark/${time}`);
        return textResult(
          `Bookmark at ${time} seconds of item ${safeId} deleted.`
        );
      })
  );
}
