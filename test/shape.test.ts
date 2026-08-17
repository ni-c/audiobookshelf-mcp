import { describe, expect, it } from 'vitest';

import {
  compactAuthor,
  compactLibraryItem,
  compactListeningStats,
  compactMediaProgress,
  compactPlaylist,
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
