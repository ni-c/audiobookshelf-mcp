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
import { compactCollection, listFrom } from '../shape.js';

const collectionIdParam = z
  .string()
  .min(1)
  .describe('Collection id, as returned by list_collections');

const libraryItemIdsParam = z
  .array(z.string().min(1))
  .min(1)
  .max(200)
  .describe('Library item ids of books');

export function registerCollectionReadTools(
  server: McpServer,
  api: AudiobookshelfApi
): void {
  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description:
        'Lists collections — the curated, ordered groups of books. Without ' +
        'library_id it returns the collections of every accessible library. ' +
        'Collections are shared server-wide; playlists are private per user.',
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
            ? '/api/collections'
            : `/api/libraries/${assertPathSegment(library_id, 'library_id')}/collections`;
        const collections = listFrom(await api.get(path), 'collections');
        return untrustedJsonResult({
          numCollections: collections.length,
          collections:
            detail === 'full'
              ? collections
              : collections.map(compactCollection),
        });
      })
  );

  server.registerTool(
    'get_collection',
    {
      title: 'Get collection',
      description:
        'Fetches one collection with the books it contains, in order.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        detail: detailParam,
      }),
      annotations: READ_ONLY,
    },
    async ({ collection_id, detail }) =>
      run(async () => {
        const data = await api.get(
          `/api/collections/${assertPathSegment(collection_id, 'collection_id')}`
        );
        return untrustedJsonResult(
          detail === 'full' ? data : compactCollection(data)
        );
      })
  );
}

export function registerCollectionWriteTools(
  server: McpServer,
  api: AudiobookshelfApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'create_collection',
    {
      title: 'Create collection',
      description:
        'Creates a collection of books. Audiobookshelf rejects empty ' +
        'collections, so at least one library item id is required, and every ' +
        'item must be a book from the given library.',
      inputSchema: z.object({
        library_id: z
          .string()
          .min(1)
          .describe('Library the collection belongs to'),
        name: z.string().min(1).max(255).describe('Collection name'),
        description: z
          .string()
          .max(4000)
          .optional()
          .describe('Optional description'),
        library_item_ids: libraryItemIdsParam,
      }),
      annotations: {
        // Additive. Not idempotent: a second call makes a second collection.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ library_id, name, description, library_item_ids }) =>
      run(async () => {
        const books = library_item_ids.map((id) =>
          assertPathSegment(id, 'library_item_id')
        );
        const created = await api.post('/api/collections', {
          libraryId: assertPathSegment(library_id, 'library_id'),
          name,
          ...(description !== undefined ? { description } : {}),
          books,
        });
        return untrustedJsonResult(compactCollection(created));
      })
  );

  server.registerTool(
    'update_collection',
    {
      title: 'Update collection',
      description:
        'Renames a collection, changes its description or reorders its books.\n\n' +
        'library_item_ids ONLY REORDERS. It cannot add or remove anything: ' +
        'Audiobookshelf sorts the books the collection already has by their ' +
        'position in this list, so an id that is not currently in the ' +
        'collection is ignored, and a book you leave out is not removed — it ' +
        'moves to the FRONT. Pass every current book, in the order you want. ' +
        'Use add_books_to_collection and remove_books_from_collection to ' +
        'change membership.\n\n' +
        'Reordering asks a person first, because the order somebody arranged ' +
        'cannot be reconstructed afterwards; renaming and re-describing do ' +
        'not. Where the client cannot show a dialog, call once to receive a ' +
        'token and again with it.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        name: z.string().min(1).max(255).optional().describe('New name'),
        description: z
          .string()
          .max(4000)
          .optional()
          .describe('New description'),
        library_item_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(200)
          .optional()
          .describe(
            'The books the collection already has, in the order you want them. ' +
              'Reorders only — it adds nothing and removes nothing.'
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
    async (
      { collection_id, name, description, library_item_ids, confirm_token },
      mcp
    ) =>
      run(async () => {
        if (
          name === undefined &&
          description === undefined &&
          library_item_ids === undefined
        ) {
          return errorResult(
            'Nothing to update: pass name, description or library_item_ids.'
          );
        }
        const safeCollection = assertPathSegment(
          collection_id,
          'collection_id'
        );
        const books = library_item_ids?.map((id) =>
          assertPathSegment(id, 'library_item_id')
        );

        // The gate hangs off the *effect*, not off the verb, and the effect
        // here is narrower than the tool's own description used to claim.
        //
        // Measured against 2.29.0: `PATCH /api/collections/{id}` treats `books`
        // as a **sort key over the membership it already has**. The controller
        // loads the existing rows and sorts them by `findIndex` in the payload,
        // so an id that is not in the collection is ignored and a book left out
        // of the list gets index -1 and moves to the *front*. Nothing is added
        // and nothing is removed — a list of ids that do not exist at all
        // answers 200 and changes nothing.
        //
        // What it does destroy is the order somebody arranged, and that is
        // exactly the consequence `remove_books_from_collection` names as its
        // reason for asking: "the curated order of the collection cannot be
        // reconstructed from here". An operation whose *only* effect is that
        // cannot be the cheaper call.
        //
        // Renaming and re-describing stay free: they are recoverable by typing
        // the old text back, and a dialog in front of every rename is how
        // people learn to tick without reading.
        if (books !== undefined) {
          const outcome = await approval.requestApproval(
            server,
            mcp,
            confirmations,
            {
              // Ids only: a collection name is user-controlled content and this
              // string is read by a model as well as by a person.
              what: `reorder the books in collection ${safeCollection}`,
              consequence:
                'The order somebody arranged is replaced and cannot be ' +
                'reconstructed from here. Nothing leaves the collection: this ' +
                'sorts the books it already has, and a book left out of the ' +
                'list moves to the front rather than being removed.',
              // Each target carries its position. `setResourceKey` sorts its
              // list before fingerprinting, so an unprefixed list would give
              // [A, B] and [B, A] the same key — and the order *is* part of
              // what this tool changes.
              resourceKey: setResourceKey('update_collection:books', [
                `collection:${safeCollection}`,
                ...books.map((id, index) => `${index}:${id}`),
              ]),
              token: confirm_token,
              toolName: 'update_collection',
              hint: 'Tick to go ahead, leave it to cancel.',
            }
          );
          if (outcome.decision === 'rejected')
            return errorResult(outcome.reason);
          if (outcome.decision === 'declined') {
            return errorResult(
              'The user declined. update_collection did nothing.'
            );
          }
          if (outcome.decision === 'pending') return outcome.result;
        }

        const updated = await api.patch(`/api/collections/${safeCollection}`, {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(books !== undefined ? { books } : {}),
        });
        return untrustedJsonResult(compactCollection(updated));
      })
  );

  server.registerTool(
    'add_books_to_collection',
    {
      title: 'Add books to collection',
      description:
        'Adds one or more books to an existing collection. Books already in the ' +
        'collection are ignored; books from a different library are rejected.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        library_item_ids: libraryItemIdsParam,
      }),
      annotations: {
        // Additive, and a collection is a set — adding a book it already
        // holds changes nothing.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ collection_id, library_item_ids }) =>
      run(async () => {
        const updated = await api.post(
          `/api/collections/${assertPathSegment(collection_id, 'collection_id')}/batch/add`,
          {
            books: library_item_ids.map((id) =>
              assertPathSegment(id, 'library_item_id')
            ),
          }
        );
        return untrustedJsonResult(compactCollection(updated));
      })
  );

  server.registerTool(
    'remove_books_from_collection',
    {
      title: 'Remove books from collection',
      description:
        'Removes books from a collection. The books themselves are untouched — ' +
        'only their membership in the collection ends, and it can be restored ' +
        'with add_books_to_collection. Asks a person first; where the client ' +
        'cannot show a dialog, call once to receive a token and again with it.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        library_item_ids: libraryItemIdsParam,
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent: removing a book that is already out leaves the same
        // collection.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ collection_id, library_item_ids, confirm_token }, mcp) =>
      run(async () => {
        const safeCollection = assertPathSegment(
          collection_id,
          'collection_id'
        );
        const books = library_item_ids.map((id) =>
          assertPathSegment(id, 'library_item_id')
        );
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            // Ids only: a collection name is user-controlled content and this
            // string is read by a model as well as by a person.
            what: `remove ${books.length} book(s) from collection ${safeCollection}`,
            consequence:
              'The curated order of the collection cannot be reconstructed ' +
              'from here — putting the books back with add_books_to_collection ' +
              'appends them at the end. The items themselves are not deleted.',
            resourceKey: setResourceKey('remove_books_from_collection', [
              safeCollection,
              ...books,
            ]),
            token: confirm_token,
            toolName: 'remove_books_from_collection',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        if (outcome.decision === 'rejected') return errorResult(outcome.reason);
        if (outcome.decision === 'declined') {
          return errorResult(
            'The user declined. remove_books_from_collection did nothing.'
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        const updated = await api.post(
          `/api/collections/${safeCollection}/batch/remove`,
          { books }
        );
        return untrustedJsonResult(compactCollection(updated));
      })
  );

  server.registerTool(
    'delete_collection',
    {
      title: 'Delete collection',
      description:
        'Deletes a collection. The books stay in the library, but the curated ' +
        'list and its order are gone. Asks a person first; where the client ' +
        'cannot show a dialog, call once to receive a token and again with it. ' +
        'Requires an Audiobookshelf account with delete permission.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        confirm_token: confirmTokenParam,
      }),
      annotations: {
        // Idempotent by the specification's wording — the second call fails,
        // but the world is the same either way.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ collection_id, confirm_token }, mcp) =>
      run(async () => {
        const safeId = assertPathSegment(collection_id, 'collection_id');
        const resource = setResourceKey('delete_collection', [safeId]);

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            // Deliberately only the id in this text — a collection name is
            // user-controlled content and this string is read by a model.
            what: `delete collection ${safeId}`,
            consequence:
              'The collection cannot be restored from here. The items it held are ' +
              'not deleted.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_collection',
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
            `The user declined. delete_collection did nothing.`
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        // Answers `200 text/plain "OK"`, not a document.
        await api.delete(`/api/collections/${safeId}`, { text: true });
        return textResult(`Collection ${safeId} deleted.`);
      })
  );
}
