import {
  expectEveryToolExercised,
  startServer,
  toolCoverage,
  tokenOf,
  type LiveHarness,
} from 'mcp-integration-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/catalogue.js';
import { bootstrap, LIBRARY_NAME, TITLES, type Sandbox } from './bootstrap.js';

/**
 * Every tool in the catalogue, against a real Audiobookshelf in Docker.
 *
 * The library is two audiobooks of near-silence, committed as a fixture,
 * because Audiobookshelf scans a directory — a library cannot be created empty
 * and then filled through the API. Everything the read tools report about
 * those books is therefore what Audiobookshelf itself made of real files.
 *
 * Order matters and state is shared: the collection, playlist and bookmark
 * created in the middle are read, edited and deleted at the end.
 */

let sandbox: Sandbox;
/** Declares elicitation, so guarded tools go through the real dialog. */
let asking: LiveHarness;
/** Declares none, so the same tools fall back to the two-call token. */
let plain: LiveHarness;

let itemId: string;
let secondItemId: string;
let collectionId: string;
let playlistId: string;
let progressId: string;

function parse<T>(text: string): T {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON in result: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start)) as T;
}

beforeAll(async () => {
  sandbox = await bootstrap();
  asking = await startServer({ env: sandbox.env, elicit: 'accept' });
  plain = await startServer({ env: sandbox.env });
}, 900_000);

afterAll(async () => {
  await asking?.close();
  await plain?.close();
});

describe('the server and the account', () => {
  it('reports what it is and who the key belongs to', async () => {
    expect(await asking.call('get_server_status')).toContain('audiobookshelf');
    expect(await asking.call('get_me')).toContain('integration');
  });

  it('lists the library the bootstrap created', async () => {
    const libraries = await asking.call('list_libraries');
    expect(libraries).toContain(LIBRARY_NAME);

    expect(
      await asking.call('get_library', { library_id: sandbox.libraryId })
    ).toContain(LIBRARY_NAME);
  });
});

describe('what the scanner made of the files', () => {
  it('found both books', async () => {
    const items = parse<{
      total: number;
      results: { id: string; title: string; durationSeconds: number }[];
    }>(
      await asking.call('list_library_items', {
        library_id: sandbox.libraryId,
        limit: 20,
      })
    );
    expect(items.total).toBe(TITLES.length);
    expect(items.results.map((i) => i.title).sort()).toEqual(
      [...TITLES].sort()
    );
    // The duration was probed out of the audio files, not read from a fixture.
    for (const item of items.results) {
      expect(item.durationSeconds).toBeGreaterThan(0);
    }
    itemId = items.results[0]!.id;
    secondItemId = items.results[1]!.id;
  });

  it('reads one back in full', async () => {
    const item = await asking.call('get_library_item', {
      library_item_id: itemId,
    });
    expect(item).toMatch(/Analytical Engine|The Compiler/);
  });

  it('read the chapters out of the audio itself', async () => {
    // Nothing here came from a fixture object: Audiobookshelf probed the WAV
    // files, so a duration and a track list exist because the files do.
    const chapters = await asking.call('get_item_chapters', {
      library_item_id: itemId,
    });
    expect(chapters).toMatch(/\d/);
  });

  it('derived the authors, series, genres and tags it could', async () => {
    // Two books by two authors, from the directory layout alone.
    const authors = parse<{ authors: { id: string; name: string }[] }>(
      await asking.call('list_authors', { library_id: sandbox.libraryId })
    );
    expect(authors.authors.length).toBeGreaterThan(0);
    await asking.call('get_author', { author_id: authors.authors[0]!.id });

    const series = parse<{ series?: { id: string }[] }>(
      await asking.call('list_series', { library_id: sandbox.libraryId })
    );
    // The fixture books are not part of a series — a series comes from the
    // directory layout, and these are author/title. So this is the empty case,
    // and `get_series` has nothing real to fetch.
    expect(series.series ?? []).toHaveLength(0);
    // Genres and tags are server-wide rather than per library.
    await asking.call('list_genres');
    await asking.call('list_tags');
    await asking.call('get_library_filter_data', {
      library_id: sandbox.libraryId,
    });
    await asking.call('get_library_stats', { library_id: sandbox.libraryId });
    await asking.call('get_personalized_shelves', {
      library_id: sandbox.libraryId,
    });
  });

  it('searches the library', async () => {
    const found = await asking.call('search_library', {
      library_id: sandbox.libraryId,
      q: 'Compiler',
    });
    expect(found).toContain('Compiler');
  });
});

describe('progress, and the statistics that follow from it', () => {
  it('records progress and reads it back', async () => {
    await asking.call('set_media_progress', {
      library_item_id: itemId,
      current_time: 0.5,
      is_finished: false,
    });
    progressId = parse<{ id: string }>(
      await asking.call('get_media_progress', { library_item_id: itemId })
    ).id;
    expect(progressId).toBeTruthy();

    // The list is derived from progress rather than stored, so this is the
    // consequence of the write above rather than a second fixture.
    const inProgress = await asking.call('list_items_in_progress');
    expect(inProgress).toContain(itemId);
  });

  it('reports listening statistics, which are empty without playback', async () => {
    // These read real sessions. Nothing in this server can create one — a
    // session is a player streaming audio — so what they prove here is that
    // the empty case is handled rather than that the numbers are right.
    await asking.call('get_listening_stats');
    await asking.call('get_year_stats', { year: 2026 });
    const sessions = parse<{ sessions: unknown[] }>(
      await asking.call('list_listening_sessions', { limit: 10 })
    );
    expect(sessions.sessions).toHaveLength(0);
  });
});

describe('bookmarks', () => {
  it('creates, edits and lists one', async () => {
    await asking.call('create_bookmark', {
      library_item_id: itemId,
      time: 1,
      title: 'Integration bookmark',
    });
    // Without a library_item_id it lists every bookmark of the account, which
    // is the shape that works: the per-item route answers 404 for an item that
    // has one, so the filter is applied here rather than upstream.
    expect(await asking.call('list_bookmarks')).toContain(
      'Integration bookmark'
    );

    await asking.call('update_bookmark', {
      library_item_id: itemId,
      time: 1,
      title: 'Integration bookmark edited',
    });
    expect(await asking.call('list_bookmarks')).toContain(
      'Integration bookmark edited'
    );
  });
});

describe('collections and playlists', () => {
  it('creates a collection and puts both books in it', async () => {
    // `library_item_ids` is required at creation: Audiobookshelf has no
    // notion of an empty collection here, so the books go in with it.
    collectionId = parse<{ id: string }>(
      await asking.call('create_collection', {
        library_id: sandbox.libraryId,
        name: 'Integration Collection',
        library_item_ids: [itemId],
      })
    ).id;

    await asking.call('add_books_to_collection', {
      collection_id: collectionId,
      library_item_ids: [secondItemId],
    });
    const one = await asking.call('get_collection', {
      collection_id: collectionId,
    });
    expect(one).toContain(itemId);
    expect(await asking.call('list_collections')).toContain(
      'Integration Collection'
    );

    const promptsBeforeRename = asking.prompts.length;
    await asking.call('update_collection', {
      collection_id: collectionId,
      name: 'Integration Collection Renamed',
    });
    // A rename asks nobody: it is recoverable by typing the old text back.
    expect(asking.prompts).toHaveLength(promptsBeforeRename);

    // Reordering asks, and this is where the semantics were established.
    // `library_item_ids` **only sorts what the collection already has**: the
    // controller loads the existing rows and orders them by `findIndex` in the
    // payload. So a book left out of the list is not removed — it gets index
    // -1 and moves to the *front*. Only a real instance shows that; the tool's
    // description used to say the list "has to contain every item that should
    // stay in the collection", which reads as "omitting removes".
    await asking.call('update_collection', {
      collection_id: collectionId,
      library_item_ids: [secondItemId, itemId],
    });
    expect(asking.prompts.length).toBe(promptsBeforeRename + 1);

    await asking.call('update_collection', {
      collection_id: collectionId,
      library_item_ids: [itemId],
    });
    const afterReorder = parse<{ books: { id: string }[] }>(
      await asking.call('get_collection', { collection_id: collectionId })
    );
    // Both books are still there — nothing was removed by the short list.
    expect(afterReorder.books.map((book) => book.id).sort()).toEqual(
      [itemId, secondItemId].sort()
    );
    // And the one that was left out went to the front.
    expect(afterReorder.books[0]!.id).toBe(secondItemId);

    // `asking` declares elicitation, so the dialog answers this — `confirmed`
    // is for the other harness, which is offered a token instead.
    await asking.call('remove_books_from_collection', {
      collection_id: collectionId,
      library_item_ids: [secondItemId],
    });
  });

  it('creates a playlist and puts one book in it', async () => {
    playlistId = parse<{ id: string }>(
      await asking.call('create_playlist', {
        library_id: sandbox.libraryId,
        name: 'Integration Playlist',
        items: [{ library_item_id: itemId }],
      })
    ).id;

    await asking.call('add_items_to_playlist', {
      playlist_id: playlistId,
      items: [{ library_item_id: secondItemId }],
    });
    expect(
      await asking.call('get_playlist', { playlist_id: playlistId })
    ).toContain(itemId);
    expect(await asking.call('list_playlists')).toContain(
      'Integration Playlist'
    );

    await asking.call('update_playlist', {
      playlist_id: playlistId,
      name: 'Integration Playlist Renamed',
    });
    // The same on playlists, and stricter: `items` must be exactly the entries
    // the playlist already has. A shorter list is refused outright.
    await asking.call('update_playlist', {
      playlist_id: playlistId,
      items: [{ library_item_id: secondItemId }, { library_item_id: itemId }],
    });
    await asking.call(
      'update_playlist',
      { playlist_id: playlistId, items: [{ library_item_id: itemId }] },
      { expectError: 'Length mismatch' }
    );
    await asking.call('remove_items_from_playlist', {
      playlist_id: playlistId,
      items: [{ library_item_id: itemId }],
    });
  });
});

describe('the fallback path for a client with no dialog', () => {
  it('deletes only after the token comes back', async () => {
    const refusal = await plain.call('delete_collection', {
      collection_id: collectionId,
    });
    expect(refusal).toContain('confirm_token');
    expect(plain.prompts).toHaveLength(0);

    await plain.call('delete_collection', {
      collection_id: collectionId,
      confirm_token: tokenOf(refusal),
    });
    expect(await plain.call('list_collections')).not.toContain(
      'Integration Collection Renamed'
    );
  });

  it('asked a person on one harness and nobody on the other', () => {
    expect(asking.prompts.length).toBeGreaterThan(0);
    expect(plain.prompts).toHaveLength(0);
  });
});

describe('cleaning up', () => {
  it('deletes the rest of what it made', async () => {
    await asking.call('delete_playlist', { playlist_id: playlistId });
    await asking.call('delete_bookmark', { library_item_id: itemId, time: 1 });
    await asking.call('delete_media_progress', {
      media_progress_id: progressId,
    });
  });
});

it('exercises every tool in the catalogue', () => {
  const called = new Set([...asking.called, ...plain.called]);
  const skipped = {
    get_podcast_episode:
      'needs a podcast library, which needs a real RSS feed Audiobookshelf ' +
      'can fetch and download episodes from. The fixture library is books, ' +
      'and pointing the suite at a public podcast would make every run depend ' +
      'on somebody else’s bandwidth.',
    list_recent_episodes:
      'needs a podcast library — see get_podcast_episode above.',
    get_series:
      'needs a series, and Audiobookshelf derives one from the directory ' +
      'layout — a book is in a series when its folder says so. The fixture ' +
      'library is author/title, which is the ordinary shape; adding a series ' +
      'folder would test the fixture rather than the tool. `list_series` *is* ' +
      'exercised, on the empty case.',
  };
  const report = toolCoverage({ called }, ALL_TOOLS, skipped);
  console.log(
    `audiobookshelf-mcp: ${report.called.length}/${ALL_TOOLS.length} tools against a real Audiobookshelf, ` +
      `${report.skipped.length} excused`
  );
  expectEveryToolExercised({ called }, ALL_TOOLS, skipped);
});
