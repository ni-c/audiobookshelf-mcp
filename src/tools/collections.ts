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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
        'Renames a collection, changes its description or reorders its books. ' +
        'library_item_ids replaces the order completely, so it has to contain ' +
        'every item that should stay in the collection — use ' +
        'add_books_to_collection and remove_books_from_collection to change ' +
        'membership.',
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
            'Complete, newly ordered list of the books in the collection'
          ),
      }),
    },
    async ({ collection_id, name, description, library_item_ids }) =>
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
        const updated = await api.patch(
          `/api/collections/${assertPathSegment(collection_id, 'collection_id')}`,
          {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(library_item_ids !== undefined
              ? {
                  books: library_item_ids.map((id) =>
                    assertPathSegment(id, 'library_item_id')
                  ),
                }
              : {}),
          }
        );
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
        'with add_books_to_collection.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        library_item_ids: libraryItemIdsParam,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ collection_id, library_item_ids }) =>
      run(async () => {
        const updated = await api.post(
          `/api/collections/${assertPathSegment(collection_id, 'collection_id')}/batch/remove`,
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
    'delete_collection',
    {
      title: 'Delete collection',
      description:
        'Deletes a collection. The books stay in the library, but the curated ' +
        'list and its order are gone. Two-step: the first call returns a ' +
        'confirmation token, the second call with that token performs the ' +
        'deletion. Requires an Audiobookshelf account with delete permission.',
      inputSchema: z.object({
        collection_id: collectionIdParam,
        confirm_token: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
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

        await api.delete(`/api/collections/${safeId}`);
        return textResult(`Collection ${safeId} deleted.`);
      })
  );
}
