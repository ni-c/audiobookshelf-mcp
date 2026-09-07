import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import { AudiobookshelfApi } from '../src/api.js';
import type { Config } from '../src/config.js';
import { run } from '../src/result.js';
import { createServer } from '../src/server.js';

/**
 * What an instance can do to this server, driven through the real thing.
 *
 * Every case here was reproduced against the built server before it was
 * written down: the answers are Audiobookshelf's to choose, and a tool that
 * fails on one of them fails for a reason the caller cannot act on. The
 * client lists the tools before it calls them, so the SDK's own
 * `structuredContent` check runs on the success path — which is what made
 * these visible at all.
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

const ESC = String.fromCharCode(0x1b);

async function connect(
  overrides: Partial<Config> = {}
): Promise<Client & { prompts: string[] }> {
  const server = createServer({ ...config, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const prompts: string[] = [];
  const client = new Client({ name: 'test', version: '0.0.0' }, {});
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  // Listing is the point: a client that has loaded tools/list validates every
  // successful result against the declared output schema.
  await client.listTools();
  return Object.assign(client, { prompts });
}

/** Answers every request with the same body, freshly built each time. */
function answerWith(
  body: string,
  init: ResponseInit = {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Promise.resolve(new Response(body, init)));
}

/**
 * The first text block of a result.
 *
 * `run` answers with `CallToolResult | InputRequiredResult`, and only the
 * first half carries `content` — an input request overlaps it in no property
 * at all, so the parameter is typed off the value and narrowed here.
 */
function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  return ((content as { text?: string }[] | undefined) ?? [])[0]?.text ?? '';
}

/** The three sentences that mean the server broke rather than answered. */
function expectNoCrash(text: string, label: string): void {
  expect(text, label).not.toContain('Output validation error');
  expect(text, label).not.toContain('Cannot read properties');
  expect(text, label).not.toContain('is not a function');
  expect(text, label).not.toContain('ERR_INVALID_ARG_TYPE');
}

/** Every read tool with arguments that reach its request. */
const READ_TOOLS: [string, Record<string, unknown>][] = [
  ['list_libraries', {}],
  ['get_library', { library_id: 'lib_1' }],
  ['get_library_stats', { library_id: 'lib_1' }],
  ['get_library_filter_data', { library_id: 'lib_1' }],
  ['list_library_items', { library_id: 'lib_1' }],
  ['search_library', { library_id: 'lib_1', q: 'dune' }],
  ['get_personalized_shelves', { library_id: 'lib_1' }],
  ['list_series', { library_id: 'lib_1' }],
  ['get_series', { series_id: 'ser_1' }],
  ['list_authors', { library_id: 'lib_1' }],
  ['get_author', { author_id: 'aut_1' }],
  ['list_tags', {}],
  ['list_genres', {}],
  ['get_server_status', {}],
  ['get_library_item', { library_item_id: 'li_1' }],
  ['get_item_chapters', { library_item_id: 'li_1' }],
  ['get_podcast_episode', { library_item_id: 'li_1', episode_id: 'ep_1' }],
  ['list_recent_episodes', { library_id: 'lib_1' }],
  ['get_me', {}],
  ['list_items_in_progress', {}],
  ['get_media_progress', { library_item_id: 'li_1' }],
  ['get_listening_stats', {}],
  ['get_year_stats', { year: 2026 }],
  ['list_listening_sessions', {}],
  ['list_bookmarks', {}],
  ['list_collections', {}],
  ['get_collection', { collection_id: 'col_1' }],
  ['list_playlists', {}],
  ['get_playlist', { playlist_id: 'pl_1' }],
];

describe('an answer this server did not expect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(READ_TOOLS)('%s survives a 200 with no body', async (name, args) => {
    // Several routes legitimately answer 200 or 204 with nothing, and
    // `request` maps that to undefined. Six tools read a property off it and
    // three more handed it to the budget, where `Buffer.byteLength(undefined)`
    // became the tool result.
    answerWith('', { status: 200, headers: {} });
    const result = await (await connect()).callTool({ name, arguments: args });
    expectNoCrash(textOf(result), name);
  });

  it.each(READ_TOOLS)(
    '%s survives entries that are not objects',
    async (name, args) => {
      // `detail: "full"` hands the raw list to a schema that promises
      // `z.array(record)`. One null among the entries failed the whole answer,
      // every good entry with it.
      answerWith(
        JSON.stringify({
          libraries: [1, null, 'x'],
          results: [1, null],
          collections: [null],
          playlists: [null],
          episodes: [null],
          sessions: [null],
          bookmarks: [null],
          libraryItems: [null],
          authors: [null],
          series: [null],
          items: [null],
          books: [null],
          media: { chapters: [null, 1] },
          days: {},
        })
      );
      const client = await connect();
      for (const detail of ['compact', 'full']) {
        const result = await client.callTool({
          name,
          arguments: { ...args, detail },
        });
        expectNoCrash(textOf(result), `${name} detail=${detail}`);
      }
    }
  );

  it.each([
    ['list_series', { library_id: 'lib_1' }],
    ['list_library_items', { library_id: 'lib_1' }],
    ['list_listening_sessions', {}],
    ['list_recent_episodes', { library_id: 'lib_1' }],
  ] as [string, Record<string, unknown>][])(
    '%s answers when the paging numbers are not numbers',
    async (name, args) => {
      // `total`, `page` and `limit` are passed straight through into fields the
      // output schema types, and `z.number()` refuses the Infinity that 1e999
      // parses to and the NaN a missing field becomes.
      for (const paging of [
        '"total": null, "page": null, "limit": null, "numPages": null',
        '"total": 1e999, "page": 1e999, "limit": 1e999, "numPages": 1e999',
        '"total": "many", "page": {}, "limit": [], "numPages": false',
      ]) {
        answerWith(
          `{${paging}, "results": [], "sessions": [], "episodes": []}`
        );
        const result = await (
          await connect()
        ).callTool({
          name,
          arguments: args,
        });
        expectNoCrash(textOf(result), `${name} with ${paging}`);
        expect(result.isError, `${name} with ${paging}`).toBeFalsy();
      }
    }
  );

  it.each([
    ['set_media_progress', { library_item_id: 'li_1', is_finished: true }],
    ['create_bookmark', { library_item_id: 'li_1', time: 5, title: 'x' }],
    ['update_bookmark', { library_item_id: 'li_1', time: 5, title: 'x' }],
  ] as [string, Record<string, unknown>][])(
    '%s answers when the readback carries nothing',
    async (name, args) => {
      // The write succeeded; the schema promised an object and got undefined,
      // so the call failed *after* the change had been made.
      answerWith('', { status: 200, headers: {} });
      const result = await (
        await connect()
      ).callTool({
        name,
        arguments: args,
      });
      expectNoCrash(textOf(result), name);
      expect(result.isError, name).toBeFalsy();
    }
  );

  it('shapes whatever the instance sends, over generated answers', async () => {
    // The example cases above are the ones somebody thought of. This is the
    // one that finds the rest: arbitrary JSON, and shaped envelopes with
    // random leaves, through every read tool.
    const client = await connect();
    const leaf = fc.oneof(
      fc.double(),
      fc.constant(null),
      fc.constant(-0),
      fc.constant(Number.MIN_SAFE_INTEGER - 1),
      fc.string({ maxLength: 30 }),
      fc.boolean(),
      fc.constant({}),
      fc.constant([])
    );
    const envelope = fc.record({
      total: leaf,
      page: leaf,
      limit: leaf,
      results: fc.array(leaf, { maxLength: 3 }),
      libraries: fc.array(leaf, { maxLength: 3 }),
      collections: fc.array(leaf, { maxLength: 3 }),
      items: fc.array(leaf, { maxLength: 3 }),
      media: fc.oneof(leaf, fc.record({ chapters: fc.array(leaf) })),
      days: fc.oneof(leaf, fc.dictionary(fc.string(), leaf)),
      mediaType: leaf,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.jsonValue(), envelope),
        fc.constantFrom(...READ_TOOLS),
        fc.constantFrom('compact', 'full'),
        async (body, [name, args], detail) => {
          answerWith(JSON.stringify(body) ?? 'null');
          const result = await client.callTool({
            name,
            arguments: { ...args, detail },
          });
          const text = textOf(result);
          expectNoCrash(text, `${name} with ${JSON.stringify(body)}`);
        }
      ),
      { numRuns: Number(process.env.SHAPE_RUNS ?? 120) }
    );
  });
});

describe('what the instance wrote, on its way to the model', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('strips a terminal escape from an error body and says whose words they are', async () => {
    answerWith(`boom${ESC}[2J still boom`, {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
    const result = await (
      await connect()
    ).callTool({
      name: 'get_library',
      arguments: { library_id: 'lib_1' },
    });
    const text = textOf(result);
    expect(text).not.toContain(ESC);
    expect(text).toContain('untrusted text from the instance');
  });

  it('strips a terminal escape from a field', async () => {
    answerWith(
      JSON.stringify({
        id: 'li_1',
        mediaType: 'book',
        media: { metadata: { title: `A${ESC}[31mB` } },
      })
    );
    const result = await (
      await connect()
    ).callTool({
      name: 'get_library_item',
      arguments: { library_item_id: 'li_1' },
    });
    expect(textOf(result)).not.toContain(ESC);
    expect(JSON.stringify(result.structuredContent)).not.toContain(ESC);
  });

  it('redacts the credentials of a private podcast feed', async () => {
    // A private feed is published as https://user:token@host/feed.rss,
    // Audiobookshelf stores it as given, and this is the tool that hands it
    // back — in both channels.
    answerWith(
      JSON.stringify({
        id: 'li_1',
        mediaType: 'podcast',
        media: {
          metadata: {
            title: 'A show',
            feedUrl: 'https://sub:s3cret@feeds.example.com/private.rss',
          },
        },
      })
    );
    const result = await (
      await connect()
    ).callTool({
      name: 'get_library_item',
      arguments: { library_item_id: 'li_1' },
    });
    expect(textOf(result)).not.toContain('s3cret');
    expect(JSON.stringify(result.structuredContent)).not.toContain('s3cret');
  });

  it('caps a content type before quoting it back', async () => {
    answerWith('{}', {
      status: 200,
      headers: { 'content-type': `text/${'x'.repeat(10_000)}` },
    });
    const result = await (
      await connect()
    ).callTool({
      name: 'get_library',
      arguments: { library_id: 'lib_1' },
    });
    expect(textOf(result).length).toBeLessThan(1000);
  });

  it('never lets get_me answer with the account’s access token', async () => {
    // GET /api/me answers with User.toOldJSONForBrowser(), and
    // MeController.getCurrentUser calls it without hideRootToken — so the
    // document carries `token`, the old non-expiring access token, for a root
    // account included. detail:"full" handed the record on whole.
    answerWith(
      JSON.stringify({
        id: 'u1',
        username: 'willi',
        type: 'root',
        token: 'eyJhbGciOiJIUzI1NiJ9.THE-ACCESS-TOKEN.sig',
        mediaProgress: [],
        bookmarks: [],
        permissions: {},
      })
    );
    const client = await connect();
    for (const detail of ['compact', 'full']) {
      const result = await client.callTool({
        name: 'get_me',
        arguments: { detail },
      });
      expect(textOf(result), detail).not.toContain('THE-ACCESS-TOKEN');
      expect(JSON.stringify(result.structuredContent), detail).not.toContain(
        'THE-ACCESS-TOKEN'
      );
    }
    // And it says a field was removed rather than quietly dropping it.
    const full = await client.callTool({
      name: 'get_me',
      arguments: { detail: 'full' },
    });
    expect(textOf(full)).toContain('token');
    expect(
      (full.structuredContent as { credentials_removed: string[] })
        .credentials_removed
    ).toEqual(['token']);
  });

  it('does not let list_bookmarks carry the token from the same endpoint', async () => {
    answerWith(
      JSON.stringify({
        id: 'u1',
        token: 'eyJhbGciOiJIUzI1NiJ9.THE-ACCESS-TOKEN.sig',
        bookmarks: [{ libraryItemId: 'li_1', title: 'x', time: 1 }],
      })
    );
    const client = await connect();
    for (const detail of ['compact', 'full']) {
      const result = await client.callTool({
        name: 'list_bookmarks',
        arguments: { detail },
      });
      expect(textOf(result), detail).not.toContain('THE-ACCESS-TOKEN');
    }
  });
});

describe('the API key on its way into a header', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to send a key with a line break, without quoting it', async () => {
    // undici's own refusal is `Headers.append: "<value>" is an invalid header
    // value.` — the whole value — and `run` turns that into the tool result.
    const key = 'eyJhbGciOi\nSECRET-PART-OF-THE-TOKEN';
    const api = new AudiobookshelfApi({ ...config, apiKey: key });
    const result = await run(async () => {
      await api.get('/api/me');
      return { content: [] };
    });
    const text = textOf(result);
    expect(text).not.toContain('SECRET-PART-OF-THE-TOKEN');
    expect(text).toContain('AUDIOBOOKSHELF_API_KEY');
  });

  it('keeps any key out of the answer, whatever is in it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 6, maxLength: 20 }),
        fc.integer({ min: 0, max: 0x1f }),
        fc.string({ minLength: 6, maxLength: 20 }),
        async (head, code, tail) => {
          const key = `${head}${String.fromCharCode(code)}${tail}`;
          const api = new AudiobookshelfApi({ ...config, apiKey: key });
          const result = await run(async () => {
            await api.get('/api/me');
            return { content: [] };
          });
          const text = textOf(result);
          // A tab is a legal header value character, so that key is sent and
          // the request fails on the network instead — either way the halves
          // of the key must not be in the answer.
          expect(text).not.toContain(head);
          expect(text).not.toContain(tail);
        }
      ),
      { numRuns: 60 }
    );
  });
});
