import { describe, expect, it } from 'vitest';

import {
  compactLibraryItem,
  compactMediaProgress,
  compactPlaylist,
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
