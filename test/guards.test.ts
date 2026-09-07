import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

/**
 * What a confirmation is worth.
 *
 * Two questions, both answered against the real server: does the token bind
 * everything the dialog claimed, and can a capability the operator removed
 * arrive through a tool that is still registered.
 */

const config: Config = {
  url: 'https://abs.example.com',
  apiKey: 'test-api-key-not-a-real-one',
  insecureTls: false,
  readOnly: false,
  elicitation: true,
  allowTools: undefined,
  denyTools: undefined,
};

type Call = { url: string; method: string; body: unknown };

function callsOf(spy: { mock: { calls: unknown[][] } }): Call[] {
  return spy.mock.calls.map(([url, init]) => {
    const request = (init ?? {}) as RequestInit;
    return {
      url: String(url),
      method: request.method ?? 'GET',
      body:
        typeof request.body === 'string' ? JSON.parse(request.body) : undefined,
    };
  });
}

function writesOf(spy: { mock: { calls: unknown[][] } }): Call[] {
  return callsOf(spy).filter((call) => call.method !== 'GET');
}

function mockJson(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  );
}

async function connect(overrides: Partial<Config> = {}): Promise<Client> {
  const server = createServer({ ...config, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  // No elicitation capability: this is the two-call token path, which is what
  // a stateless gateway takes and what these assertions can drive twice.
  const client = new Client({ name: 'test', version: '0.0.0' }, {});
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  await client.listTools();
  return client;
}

function textOf(result: { content?: unknown }): string {
  return ((result.content as { text?: string }[]) ?? [])[0]?.text ?? '';
}

function tokenOf(result: { content?: unknown }): string | undefined {
  return /confirm_token="([a-f0-9]+)"/.exec(textOf(result))?.[1];
}

describe('a token binds everything the dialog named', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'update_collection',
      { collection_id: 'col_1', library_item_ids: ['li_a', 'li_b'] },
      'name',
    ],
    [
      'update_playlist',
      { playlist_id: 'pl_1', items: [{ library_item_id: 'li_a' }] },
      'name',
    ],
  ] as [string, Record<string, unknown>, string][])(
    '%s refuses a token issued for a different %s',
    async (name, args, field) => {
      // The dialog fires on the reorder, because that is the part with no way
      // back. But the same call may carry a name and a description, and those
      // used to ride along unbound: a token issued for "reorder these books"
      // executed a second call that reordered the same books and renamed the
      // collection to something the person never saw.
      const spy = mockJson({ id: 'x', name: 'n', books: [], items: [] });
      const client = await connect();

      const first = await client.callTool({
        name,
        arguments: { ...args, [field]: 'Approved Name' },
      });
      const token = tokenOf(first);
      expect(token).toBeDefined();
      expect(writesOf(spy)).toHaveLength(0);

      const swapped = await client.callTool({
        name,
        arguments: {
          ...args,
          [field]: 'SOMETHING ELSE ENTIRELY',
          confirm_token: token,
        },
      });
      expect(swapped.isError).toBe(true);
      expect(textOf(swapped)).toContain('issued for different arguments');
      expect(writesOf(spy)).toHaveLength(0);

      // The name it was issued for still goes through.
      const same = await client.callTool({
        name,
        arguments: { ...args, [field]: 'Approved Name', confirm_token: token },
      });
      expect(same.isError).toBeFalsy();
      expect(writesOf(spy)).toHaveLength(1);
      expect(writesOf(spy)[0]?.body).toMatchObject({ name: 'Approved Name' });
    }
  );

  it.each([
    [
      'update_collection',
      { collection_id: 'col_1', library_item_ids: ['li_a'] },
    ],
    [
      'update_playlist',
      { playlist_id: 'pl_1', items: [{ library_item_id: 'li_a' }] },
    ],
  ] as [string, Record<string, unknown>][])(
    '%s refuses a token issued without a description',
    async (name, args) => {
      const spy = mockJson({ id: 'x', name: 'n', books: [], items: [] });
      const client = await connect();
      const token = tokenOf(await client.callTool({ name, arguments: args }));
      const withDescription = await client.callTool({
        name,
        arguments: {
          ...args,
          description: 'a description nobody approved',
          confirm_token: token,
        },
      });
      expect(withDescription.isError).toBe(true);
      expect(writesOf(spy)).toHaveLength(0);
    }
  );

  it('names the fields it is about to write in the sentence it asks with', async () => {
    mockJson({ id: 'col_1', name: 'n', books: [] });
    const client = await connect();
    const asked = textOf(
      await client.callTool({
        name: 'update_collection',
        arguments: {
          collection_id: 'col_1',
          library_item_ids: ['li_a'],
          name: 'New Name',
          description: 'New description',
        },
      })
    );
    expect(asked).toContain('reorder');
    expect(asked).toContain('rename it');
    expect(asked).toContain('replace its description');
    // The caller's values are shown on their own labelled lines rather than
    // interpolated into the server's sentence.
    expect(asked).toContain('New Name');
  });
});

describe('emptying a playlist is deleting it', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to empty a playlist when delete_playlist was taken away', async () => {
    // Audiobookshelf deletes a playlist outright once its last entry is
    // removed. On a server started without delete_playlist, letting that
    // through hands back the capability the operator removed under another
    // name — the allowlist is only as true as the tool boundaries are.
    const spy = mockJson({
      id: 'pl_1',
      items: [{ libraryItemId: 'li_1' }, { libraryItemId: 'li_2' }],
    });
    const client = await connect({ denyTools: 'delete_playlist' });
    const result = await client.callTool({
      name: 'remove_items_from_playlist',
      arguments: {
        playlist_id: 'pl_1',
        items: [{ library_item_id: 'li_1' }, { library_item_id: 'li_2' }],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('would leave');
    expect(textOf(result)).toContain('delete_playlist');
    expect(writesOf(spy)).toHaveLength(0);
  });

  it('still removes a subset on the same server', async () => {
    const spy = mockJson({
      id: 'pl_1',
      items: [{ libraryItemId: 'li_1' }, { libraryItemId: 'li_2' }],
    });
    const client = await connect({ denyTools: 'delete_playlist' });
    const first = await client.callTool({
      name: 'remove_items_from_playlist',
      arguments: { playlist_id: 'pl_1', items: [{ library_item_id: 'li_1' }] },
    });
    const token = tokenOf(first);
    expect(token).toBeDefined();
    const second = await client.callTool({
      name: 'remove_items_from_playlist',
      arguments: {
        playlist_id: 'pl_1',
        items: [{ library_item_id: 'li_1' }],
        confirm_token: token,
      },
    });
    expect(second.isError).toBeFalsy();
    expect(writesOf(spy)).toHaveLength(1);
  });

  it('says in the dialog that the playlist will be deleted', async () => {
    mockJson({ id: 'pl_1', items: [{ libraryItemId: 'li_1' }] });
    const client = await connect();
    const asked = textOf(
      await client.callTool({
        name: 'remove_items_from_playlist',
        arguments: {
          playlist_id: 'pl_1',
          items: [{ library_item_id: 'li_1' }],
        },
      })
    );
    expect(asked).toContain('deletes the playlist');
  });

  it('validates the ids before it asks about them', async () => {
    // The path check used to run after the approval, so the person was asked
    // about ids that had not been checked, and an approval was spent on a call
    // that could not run.
    const spy = mockJson({ id: 'pl_1', items: [] });
    const client = await connect();
    const result = await client.callTool({
      name: 'remove_items_from_playlist',
      arguments: {
        playlist_id: 'pl_1',
        items: [{ library_item_id: '../../etc/passwd' }],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('invalid library_item_id');
    expect(textOf(result)).not.toContain('confirm_token');
    expect(writesOf(spy)).toHaveLength(0);
  });
});
