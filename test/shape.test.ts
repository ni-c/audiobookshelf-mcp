import { describe, expect, it } from 'vitest';

import {
  compactAuthor,
  compactBookmark,
  compactCollection,
  compactItemPage,
  compactLibrary,
  compactLibraryItem,
  compactListeningSession,
  compactListeningStats,
  compactMediaProgress,
  compactPlaylist,
  compactPodcastEpisode,
  compactSeries,
  compactUser,
  listFrom,
  truncateText,
} from '../src/shape.js';

const expandedBook = {
  id: 'li_abc',
  libraryId: 'lib_1',
  mediaType: 'book',
  size: 512_000,
  addedAt: 1_700_000_000_000,
  media: {
    duration: 3600.5,
    tags: ['owned', 'signed'],
    chapters: [{ id: 0 }, { id: 1 }, { id: 2 }],
    audioFiles: [{ metadata: { filename: 'part1.m4b' }, ino: '123' }],
    metadata: {
      title: 'Der Schwarm',
      subtitle: 'Roman',
      authors: [{ id: 'aut_1', name: 'Frank Schätzing' }],
      narrators: ['Simon Jäger'],
      series: [{ id: 'ser_1', name: 'Ozean', sequence: '2' }],
      genres: ['Thriller'],
      publishedYear: '2004',
      language: 'German',
      description: 'Etwas im Meer wehrt sich.',
      explicit: false,
    },
  },
  userMediaProgress: {
    id: 'mp_1',
    libraryItemId: 'li_abc',
    progress: 0.4567,
    currentTime: 1644.3,
    duration: 3600.5,
    isFinished: false,
  },
};

const minifiedBook = {
  id: 'li_min',
  mediaType: 'book',
  media: {
    numChapters: 12,
    numTracks: 3,
    duration: 7200,
    metadata: {
      title: 'Minified',
      authorName: 'A. Author, B. Author',
      narratorName: 'N. Narrator',
      seriesName: 'Some Series',
    },
  },
};

describe('compactLibraryItem', () => {
  it('projects an expanded book without audio files or chapters', () => {
    const shaped = compactLibraryItem(expandedBook, {
      includeDescription: true,
    });
    expect(shaped).toMatchObject({
      id: 'li_abc',
      title: 'Der Schwarm',
      subtitle: 'Roman',
      authors: ['Frank Schätzing'],
      narrators: ['Simon Jäger'],
      series: ['Ozean #2'],
      tags: ['owned', 'signed'],
      durationSeconds: 3600.5,
      numChapters: 3,
      sizeBytes: 512_000,
      description: 'Etwas im Meer wehrt sich.',
    });
    // The parts that make the raw object huge must not survive the projection.
    expect(JSON.stringify(shaped)).not.toContain('part1.m4b');
    expect(shaped).not.toHaveProperty('media');
  });

  it('omits the description unless it was asked for', () => {
    expect(compactLibraryItem(expandedBook)).not.toHaveProperty('description');
  });

  it('converts progress into a percentage', () => {
    const shaped = compactLibraryItem(expandedBook) as {
      progress: Record<string, unknown>;
    };
    expect(shaped.progress).toMatchObject({
      progressPercent: 45.7,
      currentTimeSeconds: 1644.3,
      isFinished: false,
    });
  });

  it('reads the minified metadata form as well', () => {
    expect(compactLibraryItem(minifiedBook)).toMatchObject({
      title: 'Minified',
      authors: ['A. Author', 'B. Author'],
      narrators: ['N. Narrator'],
      series: ['Some Series'],
      numChapters: 12,
    });
  });

  it('keeps podcast fields apart from book fields', () => {
    const shaped = compactLibraryItem({
      id: 'li_pod',
      mediaType: 'podcast',
      media: {
        numEpisodes: 42,
        metadata: {
          title: 'A Podcast',
          author: 'Some Network',
          feedUrl: 'https://example.com/feed.xml',
        },
      },
    });
    expect(shaped).toMatchObject({
      title: 'A Podcast',
      authors: ['Some Network'],
      numEpisodes: 42,
      feedUrl: 'https://example.com/feed.xml',
    });
    expect(shaped).not.toHaveProperty('narrators');
    expect(shaped).not.toHaveProperty('series');
  });

  it('survives an empty or malformed object', () => {
    expect(compactLibraryItem(undefined)).toEqual({});
    expect(compactLibraryItem({ id: 'li_x', media: null })).toEqual({
      id: 'li_x',
    });
  });
});

describe('compactMediaProgress', () => {
  it('rounds the percentage to one decimal', () => {
    expect(compactMediaProgress({ progress: 1 / 3 }).progressPercent).toBe(
      33.3
    );
  });
});

describe('compactUser', () => {
  it('replaces the embedded progress and bookmark lists with counts', () => {
    const shaped = compactUser({
      id: 'usr_1',
      username: 'willi',
      type: 'admin',
      mediaProgress: [{ id: 'a' }, { id: 'b' }],
      bookmarks: [{ time: 1 }],
    });
    expect(shaped).toMatchObject({
      username: 'willi',
      numMediaProgresses: 2,
      numBookmarks: 1,
    });
    expect(shaped).not.toHaveProperty('mediaProgress');
  });
});

describe('compactPlaylist', () => {
  it('counts entries and projects the embedded items', () => {
    const shaped = compactPlaylist({
      id: 'pl_1',
      name: 'Roadtrip',
      items: [{ libraryItemId: 'li_abc', libraryItem: expandedBook }],
    });
    expect(shaped.numItems).toBe(1);
    expect(JSON.stringify(shaped)).not.toContain('part1.m4b');
  });
});

describe('compactSeries', () => {
  it('omits the embedded books unless asked for', () => {
    const series = { id: 'ser_1', name: 'Ozean', books: [expandedBook] };
    expect(compactSeries(series)).toMatchObject({
      id: 'ser_1',
      name: 'Ozean',
      numBooks: 1,
    });
    expect(compactSeries(series)).not.toHaveProperty('books');
    expect(compactSeries(series, { includeBooks: true })).toHaveProperty(
      'books'
    );
  });

  it('counts via libraryItemIds when no books are embedded', () => {
    expect(
      compactSeries({ id: 's', libraryItemIds: ['a', 'b', 'c'] }).numBooks
    ).toBe(3);
  });
});

describe('compactListeningStats', () => {
  const days: Record<string, number> = {};
  for (let i = 0; i < 100; i++) {
    days[`2026-01-${String(i).padStart(2, '0')}`] = i;
  }

  const stats = {
    totalTime: 1_432_478.29,
    today: 120,
    dayOfWeek: { Monday: 60 },
    days,
    items: {
      li_1: {
        id: 'li_1',
        mediaMetadata: { title: 'Long' },
        timeListening: 900,
      },
      li_2: {
        id: 'li_2',
        mediaMetadata: { title: 'Short' },
        timeListening: 10,
      },
    },
    recentSessions: [
      {
        id: 'sess_1',
        displayTitle: 'Long',
        timeListening: 60,
        deviceInfo: { deviceType: 'phone' },
      },
    ],
  };

  it('keeps the totals and reports how much history was dropped', () => {
    const shaped = compactListeningStats(stats);
    expect(shaped).toMatchObject({
      totalTimeSeconds: 1_432_478.29,
      todaySeconds: 120,
      numDaysWithListening: 100,
      numItemsListened: 2,
    });
    expect(Object.keys(shaped.recentDaysSeconds as object)).toHaveLength(30);
    expect(shaped.note).toMatch(/last 30 of 100 days/);
  });

  it('sorts the top items by time listened', () => {
    const shaped = compactListeningStats(stats) as {
      topItems: { id: string }[];
    };
    expect(shaped.topItems.map((i) => i.id)).toEqual(['li_1', 'li_2']);
  });

  it('drops the note when the whole history fits', () => {
    expect(
      compactListeningStats({ totalTime: 1, days: { '2026-01-01': 1 } })
    ).not.toHaveProperty('note');
  });

  it('counts the embedded sessions instead of repeating list_listening_sessions', () => {
    const shaped = compactListeningStats(stats);
    expect(shaped.numRecentSessions).toBe(1);
    expect(shaped).not.toHaveProperty('recentSessions');
    expect(JSON.stringify(shaped)).not.toContain('sess_1');
  });

  it('drops the per-item media metadata', () => {
    const shaped = compactListeningStats(stats);
    expect(JSON.stringify(shaped)).not.toContain('mediaMetadata');
  });
});

describe('compactAuthor', () => {
  const author = {
    id: 'aut_1',
    name: 'Frank Schätzing',
    numBooks: 4,
    description: 'A long biography.',
  };

  it('omits the biography in lists and keeps it for a single author', () => {
    expect(compactAuthor(author)).not.toHaveProperty('description');
    expect(compactAuthor(author, { includeDescription: true })).toMatchObject({
      id: 'aut_1',
      name: 'Frank Schätzing',
      numBooks: 4,
      description: 'A long biography.',
    });
  });
});

describe('listFrom', () => {
  it('accepts a bare array, a named envelope and a paginated envelope', () => {
    expect(listFrom(['a'], 'authors')).toEqual(['a']);
    expect(listFrom({ authors: ['a'] }, 'authors')).toEqual(['a']);
    expect(listFrom({ results: ['a'] }, 'authors')).toEqual(['a']);
    expect(listFrom({ nothing: 1 }, 'authors')).toEqual([]);
  });
});

describe('truncateText', () => {
  it('collapses whitespace and reports the original length', () => {
    expect(truncateText('  a\n\n  b  ')).toBe('a b');
    const long = 'x'.repeat(50);
    expect(truncateText(long, 10)).toBe(
      'xxxxxxxxxx… (truncated, 50 characters total)'
    );
  });

  it('returns undefined for non-strings', () => {
    expect(truncateText(undefined)).toBeUndefined();
    expect(truncateText(42)).toBeUndefined();
  });
});

describe('compactListeningSession', () => {
  it('renames the ambiguous time fields and flattens the device info', () => {
    expect(
      compactListeningSession({
        id: 'ls_1',
        displayTitle: 'Der Schwarm',
        displayAuthor: 'Frank Schätzing',
        mediaType: 'book',
        libraryItemId: 'li_abc',
        timeListening: 1800,
        currentTime: 2400.5,
        duration: 3600.5,
        playMethod: 0,
        mediaPlayer: 'html5',
        deviceInfo: { deviceType: 'phone', clientName: 'Abs Android' },
        date: '2026-08-17',
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      })
    ).toEqual({
      id: 'ls_1',
      displayTitle: 'Der Schwarm',
      displayAuthor: 'Frank Schätzing',
      mediaType: 'book',
      libraryItemId: 'li_abc',
      timeListeningSeconds: 1800,
      currentTimeSeconds: 2400.5,
      durationSeconds: 3600.5,
      playMethod: 0,
      mediaPlayer: 'html5',
      device: 'phone',
      date: '2026-08-17',
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
    });
  });

  it('falls back to the client name and survives a missing device', () => {
    expect(
      compactListeningSession({ id: 'ls_2', deviceInfo: { clientName: 'Web' } })
        .device
    ).toBe('Web');
    expect(compactListeningSession({ id: 'ls_3' }).device).toBeUndefined();
    expect(compactListeningSession(null)).toEqual({});
  });
});

describe('compactBookmark', () => {
  it('names the position field for what it is', () => {
    expect(
      compactBookmark({
        libraryItemId: 'li_abc',
        title: 'The reveal',
        time: 1234.5,
        createdAt: 1_700_000_000_000,
      })
    ).toEqual({
      libraryItemId: 'li_abc',
      title: 'The reveal',
      timeSeconds: 1234.5,
      createdAt: 1_700_000_000_000,
    });
  });
});

describe('compactLibrary', () => {
  it('keeps identity and folders and drops the scanner settings', () => {
    const library = compactLibrary({
      id: 'lib_1',
      name: 'Hörbücher',
      mediaType: 'book',
      provider: 'audible.de',
      displayOrder: 1,
      folders: [
        { id: 'fol_1', fullPath: '/audiobooks', libraryId: 'lib_1' },
        { id: 'fol_2', fullPath: '/more' },
      ],
      settings: { coverAspectRatio: 1, disableWatcher: false },
    });
    expect(library).toEqual({
      id: 'lib_1',
      name: 'Hörbücher',
      mediaType: 'book',
      provider: 'audible.de',
      displayOrder: 1,
      folders: [
        { id: 'fol_1', fullPath: '/audiobooks' },
        { id: 'fol_2', fullPath: '/more' },
      ],
    });
    expect(library).not.toHaveProperty('settings');
  });

  it('yields an empty folder list when there are none', () => {
    expect(compactLibrary({ id: 'lib_2', name: 'Empty' }).folders).toEqual([]);
  });
});

describe('compactPodcastEpisode', () => {
  it('projects an episode and reads either progress field', () => {
    expect(
      compactPodcastEpisode({
        id: 'ep_1',
        libraryItemId: 'li_pod',
        podcastId: 'pod_1',
        title: 'Folge 1',
        season: '1',
        episode: '1',
        episodeType: 'full',
        publishedAt: 1_700_000_000_000,
        pubDate: 'Mon, 01 Jan 2026 00:00:00 +0000',
        duration: 2400,
        size: 30_000_000,
        description: 'Lang und breit.',
        progress: { id: 'mp_9', progress: 0.5 },
      })
    ).toMatchObject({
      id: 'ep_1',
      title: 'Folge 1',
      durationSeconds: 2400,
      sizeBytes: 30_000_000,
      progress: { id: 'mp_9', progressPercent: 50 },
    });

    // userMediaProgress wins where both exist, and the description stays out
    // of list projections.
    const listed = compactPodcastEpisode({
      id: 'ep_2',
      description: 'not in lists',
      userMediaProgress: { id: 'mp_10' },
    });
    expect(listed.progress).toEqual({ id: 'mp_10' });
    expect(listed.description).toBeUndefined();
  });
});

describe('compactCollection', () => {
  it('counts and projects the embedded books', () => {
    const collection = compactCollection({
      id: 'col_1',
      libraryId: 'lib_1',
      name: 'Sommer 2026',
      description: '  Was ich   im Sommer höre.  ',
      books: [
        { id: 'li_1', mediaType: 'book', media: { metadata: { title: 'A' } } },
        { id: 'li_2', mediaType: 'book', media: { metadata: { title: 'B' } } },
      ],
      createdAt: 1_700_000_000_000,
      lastUpdate: 1_700_000_100_000,
    });
    expect(collection).toMatchObject({
      id: 'col_1',
      name: 'Sommer 2026',
      description: 'Was ich im Sommer höre.',
      numBooks: 2,
    });
    expect(collection.books).toEqual([
      { id: 'li_1', mediaType: 'book', title: 'A' },
      { id: 'li_2', mediaType: 'book', title: 'B' },
    ]);
    expect(collection.booksTruncated).toBeUndefined();
  });

  it('embeds only the first entries of a large collection', () => {
    // `books` was mapped unconditionally — not behind `detail`, not behind a
    // count. `/api/collections` does not paginate, so forty collections of
    // three hundred books meant twelve thousand embedded items in one *default*
    // read. `numBooks` already says how many there are, and whoever wants the
    // whole membership asks for the one collection with `get_collection`.
    const collection = compactCollection({
      id: 'col_1',
      books: Array.from({ length: 300 }, (_, i) => ({
        id: `li_${i}`,
        mediaType: 'book',
        media: { metadata: { title: `T${i}` } },
      })),
    });
    expect(collection.numBooks).toBe(300);
    expect(collection.books).toHaveLength(25);
    expect(collection.booksTruncated).toMatch(/first 25 of 300 books/);
    expect(collection.booksTruncated).toMatch(/get_collection/);
  });

  it('embeds only the first entries of a large playlist', () => {
    const playlist = compactPlaylist({
      id: 'pl_1',
      items: Array.from({ length: 300 }, (_, i) => ({
        libraryItemId: `li_${i}`,
        libraryItem: {
          id: `li_${i}`,
          mediaType: 'book',
          media: { metadata: { title: `T${i}` } },
        },
      })),
    });
    expect(playlist.numItems).toBe(300);
    expect(playlist.items).toHaveLength(25);
    expect(playlist.itemsTruncated).toMatch(/first 25 of 300 items/);
    expect(playlist.itemsTruncated).toMatch(/get_playlist/);
  });
});

describe('compactItemPage', () => {
  it('keeps the paging fields and projects the results', () => {
    const page = {
      total: 120,
      page: 2,
      limit: 25,
      sortBy: 'media.metadata.title',
      filterBy: 'authors.YWJj',
      results: [
        { id: 'li_1', mediaType: 'book', media: { metadata: { title: 'A' } } },
      ],
    };
    expect(compactItemPage(page, 'compact')).toEqual({
      total: 120,
      page: 2,
      limit: 25,
      sortBy: 'media.metadata.title',
      filterBy: 'authors.YWJj',
      numReturned: 1,
      results: [{ id: 'li_1', mediaType: 'book', title: 'A' }],
    });
    // detail="full" hands the raw entries through unchanged.
    expect(compactItemPage(page, 'full').results).toEqual(page.results);
  });
});

describe('compactAuthor', () => {
  it('projects the attributed library items when the API embeds them', () => {
    expect(
      compactAuthor({
        id: 'aut_1',
        name: 'Frank Schätzing',
        libraryItems: [
          {
            id: 'li_1',
            mediaType: 'book',
            media: { metadata: { title: 'Der Schwarm' } },
          },
        ],
      })
    ).toMatchObject({
      id: 'aut_1',
      name: 'Frank Schätzing',
      numBooks: 1,
      libraryItems: [{ id: 'li_1', title: 'Der Schwarm' }],
    });
  });
});
