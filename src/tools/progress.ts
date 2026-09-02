import { z } from 'zod';
import { marked, plain, record } from '../output-schema.js';
import type { McpServer } from '@modelcontextprotocol/server';
import { setResourceKey } from 'mcp-approval';
import type { Approver, ConfirmationStore } from 'mcp-approval';

import { assertPathSegment, type AudiobookshelfApi } from '../api.js';
import {
  errorResult,
  jsonResult,
  run,
  untrustedJsonResult,
} from '../result.js';
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
      annotations: {
        // A listening position is a marker, not authored content, and moving
        // it is what this tool is for. delete_media_progress is the one that
        // loses the history.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: marked({ updated: z.literal(true), progress: record }),
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
        // Answers `200 text/plain "OK"`, not a document.
        await api.patch(
          path,
          {
            ...(current_time !== undefined
              ? { currentTime: current_time }
              : {}),
            ...(progress !== undefined ? { progress } : {}),
            ...(is_finished !== undefined ? { isFinished: is_finished } : {}),
            ...(hide_from_continue_listening !== undefined
              ? { hideFromContinueListening: hide_from_continue_listening }
              : {}),
          },
          { text: true }
        );

        // The endpoint answers with 200 and no body; read the result back so the
        // model sees the state that actually got stored.
        const updated = await api.get(path);
        return untrustedJsonResult({ updated: true, progress: updated });
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
        'library item id. Asks a person first; where the client cannot show a ' +
        'dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        media_progress_id: z
          .string()
          .min(1)
          .describe(
            'Media progress id, from the "id" field of get_media_progress'
          ),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent: the listening history is gone either way.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: plain({ deleted_progress_id: z.string() }),
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

        // Answers `200 text/plain "OK"`, not a document.
        await api.delete(`/api/me/progress/${safeId}`, { text: true });
        return jsonResult({ deleted_progress_id: safeId });
      })
  );
}

export function registerBookmarkWriteTools(
  server: McpServer,
  api: AudiobookshelfApi,
  confirmations: ConfirmationStore,
  approval: Approver
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
      annotations: {
        // Additive. Two calls leave two bookmarks.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: marked({ created: z.literal(true), bookmark: record }),
    },
    async ({ library_item_id, time, title }) =>
      run(async () => {
        const created = await api.post(
          `/api/me/item/${assertPathSegment(library_item_id, 'library_item_id')}/bookmark`,
          { time, title }
        );
        return untrustedJsonResult({ created: true, bookmark: created });
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
      annotations: {
        // Replaces a title somebody typed, with no history.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: marked({ updated: z.literal(true), bookmark: record }),
    },
    async ({ library_item_id, time, title }) =>
      run(async () => {
        const updated = await api.patch(
          `/api/me/item/${assertPathSegment(library_item_id, 'library_item_id')}/bookmark`,
          { time, title }
        );
        return untrustedJsonResult({ updated: true, bookmark: updated });
      })
  );

  server.registerTool(
    'delete_bookmark',
    {
      title: 'Delete bookmark',
      description:
        'Deletes the bookmark at a given position. Asks a person first; where ' +
        'the client cannot show a dialog, call once to receive a token and ' +
        'again with it.',
      inputSchema: z.object({
        library_item_id: libraryItemIdParam,
        time: z
          .number()
          .min(0)
          .describe('Position in seconds identifying the bookmark'),
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent by the specification's wording.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: plain({
        deleted_bookmark: z.object({ item_id: z.string(), time: z.number() }),
      }),
    },
    async ({ library_item_id, time, confirm_token }, mcp) =>
      run(async () => {
        const safeId = assertPathSegment(library_item_id, 'library_item_id');
        // The position goes into the path, so it must be a finite number and
        // never a string that could carry path segments.
        if (!Number.isFinite(time)) {
          throw new Error('invalid time: must be a finite number of seconds');
        }
        // The description used to say this needed no confirmation because
        // "create_bookmark restores it". It restores a bookmark at that
        // position; the title somebody typed is gone, and the position is the
        // only thing the delete call knows — a wrong `time` takes out a
        // different bookmark than the one that was meant.
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete the bookmark at ${time} seconds of item ${safeId}`,
            consequence:
              'The title that was typed for it is not recoverable. ' +
              'create_bookmark makes a new one at that position, with a new ' +
              'title.',
            resourceKey: setResourceKey('delete_bookmark', [
              safeId,
              String(time),
            ]),
            token: confirm_token,
            toolName: 'delete_bookmark',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult('The user declined. delete_bookmark did nothing.');
        }
        if (outcome.decision === 'pending') return outcome.result;

        // Answers `200 text/plain "OK"`, not a document.
        await api.delete(`/api/me/item/${safeId}/bookmark/${time}`, {
          text: true,
        });
        return jsonResult({ deleted_bookmark: { item_id: safeId, time } });
      })
  );
}
