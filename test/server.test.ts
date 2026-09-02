import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

const config: Config = {
  url: 'https://abs.example.com',
  apiKey: 'test-key',
  insecureTls: false,
  readOnly: false,
};

async function connect(
  overrides: Partial<Config> = {},
  // Omitted means the client declares no elicitation capability. Passing
  // 'accept' answers every dialog with a yes, which is how a test about
  // something *after* the guard gets past it.
  elicit?: 'accept' | 'decline'
): Promise<Client> {
  const server = createServer({ ...config, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test', version: '0.0.0' },
    elicit === undefined ? {} : { capabilities: { elicitation: {} } }
  );
  if (elicit !== undefined) {
    client.setRequestHandler('elicitation/create', () =>
      elicit === 'decline'
        ? { action: 'decline' }
        : { action: 'accept', content: { confirm: true } }
    );
  }
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function mockJson(body: unknown): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  ) as ReturnType<typeof vi.spyOn>;
}

function requestedUrl(spy: { mock: { calls: unknown[][] } }, call = 0): string {
  return String(spy.mock.calls[call]?.[0]);
}

function textOf(result: { content?: unknown }): string {
  return JSON.stringify(result.content);
}

describe('server', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the read tools', async () => {
    const names = (await (await connect()).listTools()).tools.map(
      (t) => t.name
    );
    for (const expected of [
      'list_libraries',
      'list_library_items',
      'search_library',
      'get_library_item',
      'get_item_chapters',
      'get_personalized_shelves',
      'list_items_in_progress',
      'get_listening_stats',
      'list_collections',
      'list_playlists',
      'get_server_status',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('registers the write tools outside read-only mode', async () => {
    const names = (await (await connect()).listTools()).tools.map(
      (t) => t.name
    );
    for (const expected of [
      'set_media_progress',
      'delete_media_progress',
      'create_bookmark',
      'create_collection',
      'delete_collection',
      'create_playlist',
      'delete_playlist',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('does not register write tools in read-only mode', async () => {
    const names = (
      await (await connect({ readOnly: true })).listTools()
    ).tools.map((t) => t.name);
    expect(names).toContain('list_libraries');
    expect(names.filter((n) => n.startsWith('delete_'))).toEqual([]);
    expect(names).not.toContain('set_media_progress');
    expect(names).not.toContain('create_collection');
  });

  it('lists tools even without credentials', async () => {
    const client = await connect({ url: undefined, apiKey: undefined });
    expect((await client.listTools()).tools.length).toBeGreaterThan(20);
  });

  it('explains the missing configuration when a tool is called without it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect({ url: undefined, apiKey: undefined });
    const result = await client.callTool({
      name: 'list_libraries',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/AUDIOBOOKSHELF_URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks every tool that only reads as read-only', async () => {
    const tools = (await (await connect()).listTools()).tools;
    const readTool = tools.find((t) => t.name === 'list_libraries');
    expect(readTool?.annotations?.readOnlyHint).toBe(true);
    const writeTool = tools.find((t) => t.name === 'delete_collection');
    expect(writeTool?.annotations?.readOnlyHint).not.toBe(true);
    expect(writeTool?.annotations?.destructiveHint).toBe(true);
  });

  it('declares all four annotation hints on every tool', async () => {
    // Not a style rule. Two of the four default to a *stronger* claim than
    // silence suggests: the specification gives destructiveHint and
    // openWorldHint a default of true, so a tool that omits them announces
    // itself as destructive and open-world. Nine tools here had no
    // annotations block at all, which is that claim in its loudest form.
    const tools = (await (await connect()).listTools()).tools;
    const hints = [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ] as const;
    for (const tool of tools) {
      for (const hint of hints) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe(
          'boolean'
        );
      }
    }
  });

  it('warns only where something written is lost', async () => {
    // The line: content a person typed, replaced with no way back, is
    // destructive; a marker or a membership is not. Six of the fifteen write
    // tools used to inherit destructiveHint: true from the default, including
    // three called create_*.
    const tools = (await (await connect()).listTools()).tools;
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    for (const additive of [
      'create_collection',
      'create_playlist',
      'create_bookmark',
      'add_books_to_collection',
      'add_items_to_playlist',
      'set_media_progress',
    ]) {
      expect(byName.get(additive)?.destructiveHint, additive).toBe(false);
    }
    for (const destructive of [
      'update_collection',
      'update_playlist',
      'update_bookmark',
      'remove_books_from_collection',
      'remove_items_from_playlist',
      'delete_collection',
      'delete_playlist',
      'delete_bookmark',
      'delete_media_progress',
    ]) {
      expect(byName.get(destructive)?.destructiveHint, destructive).toBe(true);
    }
  });

  it('guards every tool that can drop a curated membership', async () => {
    // Written as the whole set rather than tool by tool, because the finding
    // was a hole *between* two tools. `remove_books_from_collection` asked and
    // `update_collection` reached the same end state without a question — its
    // `library_item_ids` is sent as the complete membership, so every book left
    // out of it leaves the collection. The gate boundary ran between verbs
    // instead of between effects, and the per-tool gate tests all iterate over
    // the tools that are known to ask, so none of them could see it.
    //
    // `confirm_token` in the schema is the observable half of the guard: no
    // tool declares it without going through `requestApproval`.
    const tools = (await (await connect()).listTools()).tools;
    const guarded = tools
      .filter((tool) => 'confirm_token' in (tool.inputSchema.properties ?? {}))
      .map((tool) => tool.name)
      .sort();
    expect(guarded).toEqual([
      'delete_bookmark',
      'delete_collection',
      'delete_media_progress',
      'delete_playlist',
      'remove_books_from_collection',
      'remove_items_from_playlist',
      'update_collection',
      'update_playlist',
    ]);
  });

  it('tells a set apart from an ordered list', async () => {
    // A collection holds each book once, so adding one it already has changes
    // nothing. A playlist is ordered and takes the same item twice.
    const tools = (await (await connect()).listTools()).tools;
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('add_books_to_collection')?.idempotentHint).toBe(true);
    expect(byName.get('add_items_to_playlist')?.idempotentHint).toBe(false);
  });

  it('rejects a path-traversal id before calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await (
      await connect()
    ).callTool({
      name: 'get_library_item',
      arguments: { library_item_id: '../../api/users' },
    });
    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds the base64 filter for list_library_items', async () => {
    const spy = mockJson({ results: [], total: 0, page: 0, limit: 25 });
    await (
      await connect()
    ).callTool({
      name: 'list_library_items',
      arguments: {
        library_id: 'lib_1',
        filter_group: 'progress',
        filter_value: 'finished',
      },
    });
    const url = new URL(requestedUrl(spy));
    expect(url.pathname).toBe('/api/libraries/lib_1/items');
    expect(url.searchParams.get('filter')).toBe('progress.ZmluaXNoZWQ=');
    expect(url.searchParams.get('minified')).toBe('1');
  });

  it('reports an unusable filter instead of silently listing everything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await (
      await connect()
    ).callTool({
      name: 'list_library_items',
      arguments: { library_id: 'lib_1', filter_group: 'authors' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/requires filter_value/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tells the model how to page on when more items match', async () => {
    mockJson({ results: [{ id: 'li_1' }], total: 90, page: 0, limit: 25 });
    const result = await (
      await connect()
    ).callTool({
      name: 'list_library_items',
      arguments: { library_id: 'lib_1' },
    });
    expect(textOf(result)).toMatch(/page=1/);
  });

  it('marks media content as untrusted', async () => {
    mockJson({ results: [], total: 0 });
    const result = await (
      await connect()
    ).callTool({
      name: 'list_library_items',
      arguments: { library_id: 'lib_1' },
    });
    expect(textOf(result)).toMatch(/untrusted content/);
  });

  it('asks for expanded item data including progress', async () => {
    const spy = mockJson({ id: 'li_1', mediaType: 'book', media: {} });
    await (
      await connect()
    ).callTool({
      name: 'get_library_item',
      arguments: { library_item_id: 'li_1' },
    });
    const url = new URL(requestedUrl(spy));
    expect(url.pathname).toBe('/api/items/li_1');
    expect(url.searchParams.get('expanded')).toBe('1');
    expect(url.searchParams.get('include')).toBe('progress');
  });

  it('refuses to read chapters of a podcast', async () => {
    mockJson({ id: 'li_pod', mediaType: 'podcast', media: {} });
    const result = await (
      await connect()
    ).callTool({
      name: 'get_item_chapters',
      arguments: { library_item_id: 'li_pod' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a book/);
  });

  it('requires a confirmation token before deleting a collection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect();

    const first = await client.callTool({
      name: 'delete_collection',
      arguments: { collection_id: 'col_1' },
    });
    // No API call may happen on the unconfirmed first step.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(textOf(first)).toMatch(/confirm_token/);

    const token = /confirm_token="([a-f0-9]+)"/.exec(
      JSON.parse(textOf(first))[0].text as string
    )?.[1];
    expect(token).toBeDefined();

    const bad = await client.callTool({
      name: 'delete_collection',
      arguments: { collection_id: 'col_2', confirm_token: token },
    });
    expect(bad.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not leak the collection name into the confirmation prompt', async () => {
    const client = await connect();
    const first = await client.callTool({
      name: 'delete_collection',
      arguments: { collection_id: 'col_1' },
    });
    // The prompt is read by a model, so it must not carry API-supplied text.
    expect(textOf(first)).not.toMatch(/name/i);
    expect(textOf(first)).toMatch(/col_1/);
  });

  it('rejects a create_collection call without books', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await (
      await connect()
    ).callTool({
      name: 'create_collection',
      arguments: { library_id: 'lib_1', name: 'Empty', library_item_ids: [] },
    });
    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards only whitelisted fields when setting progress', async () => {
    const spy = mockJson({ id: 'mp_1' });
    await (
      await connect()
    ).callTool({
      name: 'set_media_progress',
      arguments: {
        library_item_id: 'li_1',
        current_time: 120,
        is_finished: false,
      },
    });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      currentTime: 120,
      isFinished: false,
    });
    expect(requestedUrl(spy)).toBe(
      'https://abs.example.com/api/me/progress/li_1'
    );
  });

  it('addresses a podcast episode through the optional path segment', async () => {
    const spy = mockJson({});
    await (
      await connect()
    ).callTool({
      name: 'set_media_progress',
      arguments: {
        library_item_id: 'li_pod',
        episode_id: 'ep_1',
        current_time: 5,
      },
    });
    expect(requestedUrl(spy)).toBe(
      'https://abs.example.com/api/me/progress/li_pod/ep_1'
    );
  });

  it('refuses an empty progress update', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await (
      await connect()
    ).callTool({
      name: 'set_media_progress',
      arguments: { library_item_id: 'li_1' },
    });
    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('warns that an emptied playlist was deleted by the server', async () => {
    mockJson({ id: 'pl_1', name: 'Roadtrip', items: [] });
    const result = await (
      await connect({}, 'accept')
    ).callTool({
      name: 'remove_items_from_playlist',
      arguments: {
        playlist_id: 'pl_1',
        items: [{ library_item_id: 'li_1' }],
      },
    });
    expect(textOf(result)).toMatch(/was therefore deleted/);
  });

  it('adds a hint about the API key’s permissions on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 })
    );
    const result = await (
      await connect()
    ).callTool({ name: 'list_libraries', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/AUDIOBOOKSHELF_API_KEY/);
  });

  it('drops an HTML error page instead of forwarding it to the model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );
    const result = await (
      await connect()
    ).callTool({ name: 'list_libraries', arguments: {} });
    expect(textOf(result)).toMatch(/HTML error page omitted/);
    expect(textOf(result)).not.toMatch(/Bad Gateway/);
  });
});
