import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

const config: Config = {
  url: 'https://abs.example.com',
  apiKey: 'test-key',
  insecureTls: false,
  readOnly: false,
};

/**
 * One body that satisfies every projection: the shapes read what they know and
 * ignore the rest, so a single mock covers all endpoints.
 */
const GENERIC_BODY = {
  id: 'x',
  mediaType: 'book',
  media: { metadata: { title: 'T' }, chapters: [] },
  libraries: [],
  results: [],
  episodes: [],
  authors: [],
  collections: [],
  playlists: [],
  bookmarks: [],
  libraryItems: [],
  sessions: [],
  items: [],
  books: [],
  total: 0,
};

async function connect(overrides: Partial<Config> = {}): Promise<Client> {
  const server = createServer({ ...config, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function mockFetch(body: unknown = GENERIC_BODY) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  );
}

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

/** Every read tool with the arguments it needs and the path it must hit. */
const READ_CALLS: [string, Record<string, unknown>, string][] = [
  ['list_libraries', {}, '/api/libraries'],
  ['get_library', { library_id: 'lib_1' }, '/api/libraries/lib_1'],
  ['get_library_stats', { library_id: 'lib_1' }, '/api/libraries/lib_1/stats'],
  [
    'get_library_filter_data',
    { library_id: 'lib_1' },
    '/api/libraries/lib_1/filterdata',
  ],
  ['list_library_items', { library_id: 'lib_1' }, '/api/libraries/lib_1/items'],
  [
    'search_library',
    { library_id: 'lib_1', q: 'dune' },
    '/api/libraries/lib_1/search',
  ],
  [
    'get_personalized_shelves',
    { library_id: 'lib_1' },
    '/api/libraries/lib_1/personalized',
  ],
  ['list_series', { library_id: 'lib_1' }, '/api/libraries/lib_1/series'],
  ['get_series', { series_id: 'ser_1' }, '/api/series/ser_1'],
  ['list_authors', { library_id: 'lib_1' }, '/api/libraries/lib_1/authors'],
  ['get_author', { author_id: 'aut_1' }, '/api/authors/aut_1'],
  ['list_tags', {}, '/api/tags'],
  ['list_genres', {}, '/api/genres'],
  ['get_server_status', {}, '/status'],
  ['get_library_item', { library_item_id: 'li_1' }, '/api/items/li_1'],
  ['get_item_chapters', { library_item_id: 'li_1' }, '/api/items/li_1'],
  [
    'get_podcast_episode',
    { library_item_id: 'li_1', episode_id: 'ep_1' },
    '/api/podcasts/li_1/episode/ep_1',
  ],
  [
    'list_recent_episodes',
    { library_id: 'lib_1' },
    '/api/libraries/lib_1/recent-episodes',
  ],
  ['get_me', {}, '/api/me'],
  ['list_items_in_progress', {}, '/api/me/items-in-progress'],
  ['get_media_progress', { library_item_id: 'li_1' }, '/api/me/progress/li_1'],
  [
    'get_media_progress',
    { library_item_id: 'li_1', episode_id: 'ep_1' },
    '/api/me/progress/li_1/ep_1',
  ],
  ['get_listening_stats', {}, '/api/me/listening-stats'],
  ['get_year_stats', { year: 2026 }, '/api/me/stats/year/2026'],
  ['list_listening_sessions', {}, '/api/me/listening-sessions'],
  ['list_bookmarks', {}, '/api/me/bookmarks'],
  ['list_bookmarks', { library_item_id: 'li_1' }, '/api/me/bookmarks/li_1'],
  ['list_collections', {}, '/api/collections'],
  [
    'list_collections',
    { library_id: 'lib_1' },
    '/api/libraries/lib_1/collections',
  ],
  ['get_collection', { collection_id: 'col_1' }, '/api/collections/col_1'],
  ['list_playlists', {}, '/api/playlists'],
  ['list_playlists', { library_id: 'lib_1' }, '/api/libraries/lib_1/playlists'],
  ['get_playlist', { playlist_id: 'pl_1' }, '/api/playlists/pl_1'],
];

describe('read tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(READ_CALLS)(
    '%s hits %s and succeeds',
    async (name, args, expectedPath) => {
      const spy = mockFetch();
      const result = await (
        await connect()
      ).callTool({ name, arguments: args });
      expect(result.isError).toBeFalsy();
      expect(new URL(callsOf(spy)[0]!.url).pathname).toBe(expectedPath);
      expect(callsOf(spy)[0]!.method).toBe('GET');
    }
  );

  it.each(READ_CALLS)(
    '%s also works with detail="full"',
    async (name, args) => {
      mockFetch();
      const result = await (
        await connect()
      ).callTool({ name, arguments: { ...args, detail: 'full' } });
      // Tools without a detail parameter simply ignore the extra argument.
      expect(result.isError).toBeFalsy();
    }
  );

  it('passes paging and sorting through to the items endpoint', async () => {
    const spy = mockFetch();
    await (
      await connect()
    ).callTool({
      name: 'list_library_items',
      arguments: {
        library_id: 'lib_1',
        page: 2,
        limit: 50,
        sort: 'media.metadata.title',
        descending: true,
        collapse_series: true,
      },
    });
    const url = new URL(callsOf(spy)[0]!.url);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('sort')).toBe('media.metadata.title');
    expect(url.searchParams.get('desc')).toBe('1');
    expect(url.searchParams.get('collapseseries')).toBe('1');
  });

  it('asks for the author’s items only when requested', async () => {
    const spy = mockFetch();
    await (
      await connect()
    ).callTool({
      name: 'get_author',
      arguments: {
        author_id: 'aut_1',
        include_items: true,
        library_id: 'lib_1',
      },
    });
    const url = new URL(callsOf(spy)[0]!.url);
    expect(url.searchParams.get('include')).toBe('items');
    expect(url.searchParams.get('library')).toBe('lib_1');
  });

  it('shapes the grouped search response', async () => {
    mockFetch({
      book: [
        {
          matchKey: 'title',
          matchText: 'Dune',
          libraryItem: { id: 'li_1', mediaType: 'book', media: {} },
        },
      ],
      series: [{ series: { id: 'ser_1', name: 'Dune' } }],
      authors: [{ id: 'aut_1', name: 'Frank Herbert' }],
    });
    const result = await (
      await connect()
    ).callTool({
      name: 'search_library',
      arguments: { library_id: 'lib_1', q: 'dune' },
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain('li_1');
    expect(text).toContain('ser_1');
    expect(text).toContain('Frank Herbert');
  });
});

describe('write tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a collection with its books', async () => {
    const spy = mockFetch();
    const result = await (
      await connect()
    ).callTool({
      name: 'create_collection',
      arguments: {
        library_id: 'lib_1',
        name: 'Favourites',
        description: 'The good ones',
        library_item_ids: ['li_1', 'li_2'],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(callsOf(spy)[0]).toMatchObject({
      method: 'POST',
      body: {
        libraryId: 'lib_1',
        name: 'Favourites',
        description: 'The good ones',
        books: ['li_1', 'li_2'],
      },
    });
  });

  it('updates and reorders a collection', async () => {
    const spy = mockFetch();
    await (
      await connect()
    ).callTool({
      name: 'update_collection',
      arguments: {
        collection_id: 'col_1',
        name: 'Renamed',
        library_item_ids: ['li_2', 'li_1'],
      },
    });
    expect(callsOf(spy)[0]).toMatchObject({
      method: 'PATCH',
      body: { name: 'Renamed', books: ['li_2', 'li_1'] },
    });
  });

  it('refuses an update without any field', async () => {
    const spy = mockFetch();
    for (const [name, args] of [
      ['update_collection', { collection_id: 'col_1' }],
      ['update_playlist', { playlist_id: 'pl_1' }],
    ] as [string, Record<string, unknown>][]) {
      const result = await (
        await connect()
      ).callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'add_books_to_collection',
      { collection_id: 'col_1', library_item_ids: ['li_1'] },
      '/api/collections/col_1/batch/add',
      { books: ['li_1'] },
    ],
    [
      'remove_books_from_collection',
      { collection_id: 'col_1', library_item_ids: ['li_1'] },
      '/api/collections/col_1/batch/remove',
      { books: ['li_1'] },
    ],
    [
      'add_items_to_playlist',
      { playlist_id: 'pl_1', items: [{ library_item_id: 'li_1' }] },
      '/api/playlists/pl_1/batch/add',
      { items: [{ libraryItemId: 'li_1' }] },
    ],
  ] as [string, Record<string, unknown>, string, unknown][])(
    '%s posts to %s',
    async (name, args, path, body) => {
      const spy = mockFetch();
      const result = await (
        await connect()
      ).callTool({ name, arguments: args });
      expect(result.isError).toBeFalsy();
      const call = callsOf(spy)[0]!;
      expect(new URL(call.url).pathname).toBe(path);
      expect(call.method).toBe('POST');
      expect(call.body).toEqual(body);
    }
  );

  it('creates a playlist, empty or with podcast episodes', async () => {
    const spy = mockFetch();
    const client = await connect();

    await client.callTool({
      name: 'create_playlist',
      arguments: { library_id: 'lib_1', name: 'Empty' },
    });
    expect(callsOf(spy)[0]!.body).toEqual({
      libraryId: 'lib_1',
      name: 'Empty',
      items: [],
    });

    await client.callTool({
      name: 'create_playlist',
      arguments: {
        library_id: 'lib_1',
        name: 'Podcast',
        items: [{ library_item_id: 'li_1', episode_id: 'ep_1' }],
      },
    });
    expect(callsOf(spy)[1]!.body).toMatchObject({
      items: [{ libraryItemId: 'li_1', episodeId: 'ep_1' }],
    });
  });

  it('updates a playlist', async () => {
    const spy = mockFetch();
    await (
      await connect()
    ).callTool({
      name: 'update_playlist',
      arguments: { playlist_id: 'pl_1', description: 'New' },
    });
    expect(callsOf(spy)[0]).toMatchObject({
      method: 'PATCH',
      body: { description: 'New' },
    });
  });

  it('manages bookmarks', async () => {
    const spy = mockFetch();
    const client = await connect();

    await client.callTool({
      name: 'create_bookmark',
      arguments: { library_item_id: 'li_1', time: 90, title: 'Cliffhanger' },
    });
    expect(callsOf(spy)[0]).toMatchObject({
      method: 'POST',
      body: { time: 90, title: 'Cliffhanger' },
    });
    expect(new URL(callsOf(spy)[0]!.url).pathname).toBe(
      '/api/me/item/li_1/bookmark'
    );

    await client.callTool({
      name: 'update_bookmark',
      arguments: { library_item_id: 'li_1', time: 90, title: 'Renamed' },
    });
    expect(callsOf(spy)[1]!.method).toBe('PATCH');

    await client.callTool({
      name: 'delete_bookmark',
      arguments: { library_item_id: 'li_1', time: 90.5 },
    });
    expect(callsOf(spy)[2]!.method).toBe('DELETE');
    expect(new URL(callsOf(spy)[2]!.url).pathname).toBe(
      '/api/me/item/li_1/bookmark/90.5'
    );
  });

  it.each([
    ['delete_collection', 'collection_id', 'col_1', '/api/collections/col_1'],
    ['delete_playlist', 'playlist_id', 'pl_1', '/api/playlists/pl_1'],
    [
      'delete_media_progress',
      'media_progress_id',
      'mp_1',
      '/api/me/progress/mp_1',
    ],
  ])(
    '%s deletes only after the confirmation token is presented',
    async (name, idParam, id, path) => {
      const spy = mockFetch();
      const client = await connect();

      const first = await client.callTool({
        name,
        arguments: { [idParam]: id },
      });
      expect(spy).not.toHaveBeenCalled();
      const prompt = (
        JSON.parse(JSON.stringify(first.content)) as { text: string }[]
      )[0]!.text;
      const token = /confirm_token="([a-f0-9]+)"/.exec(prompt)?.[1];
      expect(token).toBeDefined();

      const second = await client.callTool({
        name,
        arguments: { [idParam]: id, confirm_token: token },
      });
      expect(second.isError).toBeFalsy();
      const call = callsOf(spy)[0]!;
      expect(call.method).toBe('DELETE');
      expect(new URL(call.url).pathname).toBe(path);

      // The token is single-use: replaying it must not delete again.
      const replay = await client.callTool({
        name,
        arguments: { [idParam]: id, confirm_token: token },
      });
      expect(replay.isError).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  );
});

/** Text of the first content block of a tool result. */
function firstText(result: unknown): string {
  const content = (result as { content?: { text?: string }[] }).content ?? [];
  return content[0]?.text ?? '';
}

/** The JSON payload of a result, with the untrusted-content preamble stripped. */
function payload(result: unknown): Record<string, unknown> {
  const text = firstText(result);
  const start = text.indexOf('{');
  return JSON.parse(text.slice(start === -1 ? 0 : start)) as Record<
    string,
    unknown
  >;
}

describe('projections in the read tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shapes the personalized shelves and passes non-media entities through', async () => {
    mockFetch([
      {
        id: 'continue-listening',
        label: 'Continue Listening',
        type: 'book',
        entities: [
          {
            id: 'li_1',
            mediaType: 'book',
            media: {
              metadata: { title: 'Der Schwarm' },
              audioFiles: [{ metadata: { filename: 'part1.m4b' } }],
            },
          },
        ],
      },
      {
        id: 'recent-series',
        label: 'Recent Series',
        type: 'series',
        entities: [{ id: 'ser_1', name: 'Ozean' }],
      },
    ]);
    const result = await (
      await connect()
    ).callTool({
      name: 'get_personalized_shelves',
      arguments: { library_id: 'lib_1' },
    });

    const shelves = JSON.parse(
      firstText(result).slice(firstText(result).indexOf('['))
    ) as { type: string; entities: Record<string, unknown>[] }[];
    expect(shelves).toHaveLength(2);
    // A book shelf is projected...
    expect(shelves[0]!.entities[0]).toEqual({
      id: 'li_1',
      mediaType: 'book',
      title: 'Der Schwarm',
    });
    // ...a series shelf is handed through as-is.
    expect(shelves[1]!.entities[0]).toEqual({ id: 'ser_1', name: 'Ozean' });
    expect(firstText(result)).not.toContain('part1.m4b');
  });

  it('projects the series and author lists', async () => {
    mockFetch({
      total: 1,
      page: 0,
      limit: 25,
      series: [{ id: 'ser_1', name: 'Ozean', libraryItemIds: ['a', 'b'] }],
    });
    const seriesResult = await (
      await connect()
    ).callTool({ name: 'list_series', arguments: { library_id: 'lib_1' } });
    expect(payload(seriesResult).results).toEqual([
      { id: 'ser_1', name: 'Ozean', numBooks: 2 },
    ]);

    vi.restoreAllMocks();
    mockFetch({
      authors: [
        {
          id: 'aut_1',
          name: 'Frank Schätzing',
          numBooks: 9,
          description: 'Bio',
        },
      ],
    });
    const authorResult = await (
      await connect()
    ).callTool({ name: 'list_authors', arguments: { library_id: 'lib_1' } });
    expect(payload(authorResult)).toMatchObject({
      numAuthors: 1,
      authors: [{ id: 'aut_1', name: 'Frank Schätzing', numBooks: 9 }],
    });
    // A biography runs to hundreds of words — not in a list.
    expect(firstText(authorResult)).not.toContain('Bio');
  });

  it('projects the items-in-progress list', async () => {
    mockFetch({
      libraryItems: [
        {
          id: 'li_1',
          mediaType: 'book',
          media: {
            metadata: { title: 'Der Schwarm' },
            audioFiles: [{ metadata: { filename: 'part1.m4b' } }],
          },
          progressLastUpdate: 1_700_000_000_000,
        },
      ],
    });
    const result = await (
      await connect()
    ).callTool({ name: 'list_items_in_progress', arguments: {} });
    expect(payload(result)).toEqual({
      numReturned: 1,
      libraryItems: [
        {
          id: 'li_1',
          mediaType: 'book',
          title: 'Der Schwarm',
          progressLastUpdate: 1_700_000_000_000,
        },
      ],
    });
  });

  it('names the podcast a recent episode belongs to', async () => {
    mockFetch({
      limit: 25,
      page: 0,
      episodes: [
        {
          id: 'ep_1',
          title: 'Folge 1',
          duration: 2400,
          podcast: { metadata: { title: 'Lage der Nation' } },
        },
        { id: 'ep_2', title: 'Folge 2' },
      ],
    });
    const result = await (
      await connect()
    ).callTool({
      name: 'list_recent_episodes',
      arguments: { library_id: 'lib_1' },
    });
    const body = payload(result) as { episodes: Record<string, unknown>[] };
    expect(body.episodes[0]).toMatchObject({
      id: 'ep_1',
      title: 'Folge 1',
      durationSeconds: 2400,
      podcastTitle: 'Lage der Nation',
    });
    // Without an embedded podcast there is simply no title to add.
    expect(body.episodes[1]).not.toHaveProperty('podcastTitle');
  });

  it('shapes podcast hits in the grouped search response', async () => {
    mockFetch({
      podcast: [
        {
          matchKey: 'title',
          matchText: 'Lage',
          libraryItem: {
            id: 'li_pod',
            mediaType: 'podcast',
            media: { metadata: { title: 'Lage der Nation' } },
          },
        },
      ],
    });
    const result = await (
      await connect()
    ).callTool({
      name: 'search_library',
      arguments: { library_id: 'lib_1', q: 'lage' },
    });
    const body = payload(result) as { podcast: Record<string, unknown>[] };
    expect(body.podcast[0]).toEqual({
      matchKey: 'title',
      matchText: 'Lage',
      libraryItem: {
        id: 'li_pod',
        mediaType: 'podcast',
        title: 'Lage der Nation',
      },
    });
  });
});

describe('write tool edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the progress back so the model sees what was stored', async () => {
    const spy = mockFetch({ id: 'mp_1', progress: 0.5, currentTime: 120 });
    const result = await (
      await connect()
    ).callTool({
      name: 'set_media_progress',
      arguments: { library_item_id: 'li_1', current_time: 120 },
    });

    const calls = callsOf(spy);
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET']);
    expect(firstText(result)).toMatch(/^Progress updated\./);
    expect(firstText(result)).toContain('"currentTime": 120');
  });

  it('refuses a bookmark position that is not a finite number', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await (
      await connect()
    ).callTool({
      name: 'delete_bookmark',
      arguments: { library_item_id: 'li_1', time: Number.POSITIVE_INFINITY },
    });
    expect(result.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('says so when removing the last entry deleted the playlist', async () => {
    mockFetch({ id: 'pl_1', name: 'Roadtrip', items: [] });
    const result = await (
      await connect()
    ).callTool({
      name: 'remove_items_from_playlist',
      arguments: { playlist_id: 'pl_1', items: [{ library_item_id: 'li_1' }] },
    });
    expect(firstText(result)).toMatch(/deleted by Audiobookshelf/);
    expect(firstText(result)).toMatch(/cannot be restored/i);
  });

  it('sends the optional description only when it was given', async () => {
    const spy = mockFetch({ id: 'col_1', name: 'X', books: [] });
    const client = await connect();
    await client.callTool({
      name: 'create_collection',
      arguments: {
        library_id: 'lib_1',
        name: 'X',
        library_item_ids: ['li_1'],
        description: 'Because',
      },
    });
    await client.callTool({
      name: 'create_playlist',
      arguments: { library_id: 'lib_1', name: 'Y' },
    });

    const [collection, playlist] = callsOf(spy);
    expect(collection!.body).toEqual({
      libraryId: 'lib_1',
      name: 'X',
      description: 'Because',
      books: ['li_1'],
    });
    // No description passed, and an omitted item list becomes an empty one.
    expect(playlist!.body).toEqual({
      libraryId: 'lib_1',
      name: 'Y',
      items: [],
    });
  });
});
