/**
 * Compact projections of Audiobookshelf objects.
 *
 * An expanded library item carries every audio file, track and chapter with full
 * ffprobe metadata — a single book easily exceeds 40 kB of JSON, a page of 25 of
 * them exceeds the useful context of any model. Every tool that returns media
 * therefore defaults to a projection and offers `detail: "full"` for the raw
 * object.
 *
 * The projections mirror Audiobookshelf's own field names (camelCase) so ids and
 * values can be matched against the API docs; only derived fields
 * (`durationSeconds`, `progressPercent`) are new.
 */

export const DETAIL_LEVELS = ['compact', 'full'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const DETAIL_DESCRIPTION =
  '"compact" (default) returns a projection with the fields that matter for ' +
  'browsing; "full" returns the raw Audiobookshelf object including audio files, ' +
  'tracks and chapters, which is very large.';

/** Descriptions from metadata providers and podcast feeds can be many kB. */
const DESCRIPTION_MAX_LENGTH = 800;

function rec(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Pulls the list out of an Audiobookshelf response.
 *
 * Several endpoints return a bare array, an envelope (`{ libraries: [...] }`) or
 * a paginated envelope (`{ results: [...] }`) depending on the parameters — the
 * authors endpoint switches shape based on whether `limit` and `page` were both
 * given. Accepting all three keeps the tools from returning an empty list when
 * the server picks the other form.
 */
export function listFrom(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const object = rec(value);
  for (const key of [...keys, 'results']) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

/** Drops undefined values so the projection stays free of empty keys. */
function defined<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export function truncateText(
  value: unknown,
  max = DESCRIPTION_MAX_LENGTH
): string | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}… (truncated, ${collapsed.length} characters total)`;
}

/** `[{ name, sequence }]` or the minified `seriesName` string → `["Name #2"]`. */
function seriesLabels(metadata: Record<string, unknown>): string[] | undefined {
  const series = arr(metadata.series);
  if (series.length > 0) {
    return series.map((entry) => {
      const item = rec(entry);
      const name = str(item.name) ?? '(unnamed series)';
      const sequence = str(item.sequence);
      return sequence ? `${name} #${sequence}` : name;
    });
  }
  const name = str(metadata.seriesName);
  return name ? [name] : undefined;
}

/** `[{ id, name }]` or the minified `authorName` string → `["Name"]`. */
function nameList(
  entries: unknown,
  minifiedFallback: unknown
): string[] | undefined {
  const list = arr(entries);
  if (list.length > 0) {
    return list.map((entry) =>
      typeof entry === 'string' ? entry : (str(rec(entry).name) ?? '(unnamed)')
    );
  }
  const joined = str(minifiedFallback);
  return joined ? joined.split(', ').filter(Boolean) : undefined;
}

export function compactMediaProgress(value: unknown): Record<string, unknown> {
  const progress = rec(value);
  const fraction = num(progress.progress);
  return defined({
    id: str(progress.id),
    libraryItemId: str(progress.libraryItemId),
    episodeId: str(progress.episodeId),
    isFinished: bool(progress.isFinished),
    progressPercent:
      fraction === undefined ? undefined : Math.round(fraction * 1000) / 10,
    currentTimeSeconds: num(progress.currentTime),
    durationSeconds: num(progress.duration),
    hideFromContinueListening: bool(progress.hideFromContinueListening),
    startedAt: num(progress.startedAt),
    finishedAt: num(progress.finishedAt),
    lastUpdate: num(progress.lastUpdate),
  });
}

/**
 * The `/api/me` user object embeds every media progress and every bookmark the
 * account has ever created — for a long-running instance that is by far the
 * largest response of the whole API. The projection keeps identity and
 * permissions and reports the collections as counts.
 */
export function compactUser(value: unknown): Record<string, unknown> {
  const user = rec(value);
  return defined({
    id: str(user.id),
    username: str(user.username),
    type: str(user.type),
    isActive: bool(user.isActive),
    isLocked: bool(user.isLocked),
    createdAt: num(user.createdAt),
    lastSeen: num(user.lastSeen),
    permissions: user.permissions,
    librariesAccessible: user.librariesAccessible,
    itemTagsSelected: user.itemTagsSelected,
    numMediaProgresses: arr(user.mediaProgress).length,
    numBookmarks: arr(user.bookmarks).length,
    numSeriesHiddenFromContinueListening: arr(
      user.seriesHideFromContinueListening
    ).length,
  });
}

export function compactListeningSession(
  value: unknown
): Record<string, unknown> {
  const session = rec(value);
  const device = rec(session.deviceInfo);
  return defined({
    id: str(session.id),
    displayTitle: str(session.displayTitle),
    displayAuthor: str(session.displayAuthor),
    mediaType: str(session.mediaType),
    libraryItemId: str(session.libraryItemId),
    episodeId: str(session.episodeId),
    timeListeningSeconds: num(session.timeListening),
    currentTimeSeconds: num(session.currentTime),
    durationSeconds: num(session.duration),
    playMethod: num(session.playMethod),
    mediaPlayer: str(session.mediaPlayer),
    device: str(device.deviceType) ?? str(device.clientName),
    date: str(session.date),
    startedAt: num(session.startedAt),
    updatedAt: num(session.updatedAt),
  });
}

export function compactBookmark(value: unknown): Record<string, unknown> {
  const bookmark = rec(value);
  return defined({
    libraryItemId: str(bookmark.libraryItemId),
    title: str(bookmark.title),
    timeSeconds: num(bookmark.time),
    createdAt: num(bookmark.createdAt),
  });
}

export function compactLibrary(value: unknown): Record<string, unknown> {
  const library = rec(value);
  return defined({
    id: str(library.id),
    name: str(library.name),
    mediaType: str(library.mediaType),
    provider: str(library.provider),
    displayOrder: num(library.displayOrder),
    folders: arr(library.folders).map((folder) =>
      defined({
        id: str(rec(folder).id),
        fullPath: str(rec(folder).fullPath),
      })
    ),
  });
}

export interface CompactItemOptions {
  /** Include the (truncated) description — used for single-item lookups. */
  includeDescription?: boolean;
}

export function compactLibraryItem(
  value: unknown,
  options: CompactItemOptions = {}
): Record<string, unknown> {
  const item = rec(value);
  const media = rec(item.media);
  const metadata = rec(media.metadata);
  const isPodcast = str(item.mediaType) === 'podcast';
  const chapters = arr(media.chapters);
  const episodes = arr(media.episodes);
  const progress = item.userMediaProgress;

  return defined({
    id: str(item.id),
    libraryId: str(item.libraryId),
    mediaType: str(item.mediaType),
    title: str(metadata.title),
    subtitle: str(metadata.subtitle),
    authors: isPodcast
      ? nameList(undefined, metadata.author)
      : nameList(metadata.authors, metadata.authorName),
    narrators: isPodcast
      ? undefined
      : nameList(metadata.narrators, metadata.narratorName),
    series: isPodcast ? undefined : seriesLabels(metadata),
    genres: nameList(metadata.genres, undefined),
    tags: nameList(media.tags, undefined),
    publishedYear: str(metadata.publishedYear),
    publisher: str(metadata.publisher),
    language: str(metadata.language),
    explicit: bool(metadata.explicit),
    abridged: isPodcast ? undefined : bool(metadata.abridged),
    isbn: str(metadata.isbn),
    asin: str(metadata.asin),
    feedUrl: isPodcast ? str(metadata.feedUrl) : undefined,
    durationSeconds: num(media.duration),
    numChapters: chapters.length > 0 ? chapters.length : num(media.numChapters),
    numEpisodes: episodes.length > 0 ? episodes.length : num(media.numEpisodes),
    numTracks: num(media.numTracks),
    sizeBytes: num(item.size),
    addedAt: num(item.addedAt),
    updatedAt: num(item.updatedAt),
    isMissing: bool(item.isMissing) === true ? true : undefined,
    isInvalid: bool(item.isInvalid) === true ? true : undefined,
    progress:
      progress === undefined || progress === null
        ? undefined
        : compactMediaProgress(progress),
    // `/api/me/items-in-progress` carries no progress object, only the timestamp
    // of the last update — and for podcasts the episode that was in progress.
    progressLastUpdate: num(item.progressLastUpdate),
    recentEpisode:
      item.recentEpisode === undefined || item.recentEpisode === null
        ? undefined
        : compactPodcastEpisode(item.recentEpisode),
    description: options.includeDescription
      ? truncateText(metadata.description)
      : undefined,
  });
}

export function compactPodcastEpisode(
  value: unknown,
  options: CompactItemOptions = {}
): Record<string, unknown> {
  const episode = rec(value);
  const progress = episode.userMediaProgress ?? episode.progress;
  return defined({
    id: str(episode.id),
    libraryItemId: str(episode.libraryItemId),
    podcastId: str(episode.podcastId),
    title: str(episode.title),
    subtitle: str(episode.subtitle),
    season: str(episode.season),
    episode: str(episode.episode),
    episodeType: str(episode.episodeType),
    publishedAt: num(episode.publishedAt),
    pubDate: str(episode.pubDate),
    durationSeconds: num(episode.duration),
    sizeBytes: num(episode.size),
    progress:
      progress === undefined || progress === null
        ? undefined
        : compactMediaProgress(progress),
    description: options.includeDescription
      ? truncateText(episode.description)
      : undefined,
  });
}

/**
 * `includeBooks` is off for lists on purpose: the series endpoint embeds the full
 * book of every entry even when minified, which makes a page of ten series an
 * order of magnitude larger than the series data itself.
 */
export function compactSeries(
  value: unknown,
  options: { includeBooks?: boolean } = {}
): Record<string, unknown> {
  const series = rec(value);
  const books = arr(series.books);
  return defined({
    id: str(series.id),
    name: str(series.name),
    numBooks:
      books.length > 0 ? books.length : arr(series.libraryItemIds).length,
    totalDurationSeconds: num(series.totalDuration),
    addedAt: num(series.addedAt),
    books:
      options.includeBooks === true && books.length > 0
        ? books.map((b) => compactLibraryItem(b))
        : undefined,
  });
}

/** Days of listening history kept in the projection of the stats endpoint. */
const RECENT_DAYS = 30;
/** Items reported in the projection of the stats endpoint. */
const TOP_ITEMS = 10;

/**
 * `/api/me/listening-stats` is the largest response of the whole API: it embeds
 * the complete media metadata of every item ever listened to, the totals of every
 * calendar day since the account exists, and ten full session objects. On a
 * three-year-old instance that is ~95 kB. The projection keeps the totals, the
 * last 30 days and the top items.
 */
export function compactListeningStats(value: unknown): Record<string, unknown> {
  const stats = rec(value);
  const days = rec(stats.days);
  const items = rec(stats.items);

  const dayEntries = Object.entries(days)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort(([a], [b]) => b.localeCompare(a));

  const topItems = Object.values(items)
    .map((entry) => {
      const item = rec(entry);
      return {
        id: str(item.id),
        title: str(rec(item.mediaMetadata).title),
        timeListeningSeconds: num(item.timeListening) ?? 0,
      };
    })
    .sort((a, b) => b.timeListeningSeconds - a.timeListeningSeconds)
    .slice(0, TOP_ITEMS);

  return defined({
    totalTimeSeconds: num(stats.totalTime),
    todaySeconds: num(stats.today),
    dayOfWeekSeconds: stats.dayOfWeek,
    numDaysWithListening: dayEntries.length,
    numItemsListened: Object.keys(items).length,
    recentDaysSeconds: Object.fromEntries(dayEntries.slice(0, RECENT_DAYS)),
    topItems,
    // The endpoint also embeds ten full session objects. They are left out here:
    // list_listening_sessions returns the same data, paginated and shaped.
    numRecentSessions: arr(stats.recentSessions).length,
    note:
      dayEntries.length > RECENT_DAYS
        ? `Only the last ${RECENT_DAYS} of ${dayEntries.length} days with listening are shown — call with detail="full" for the complete history. Recent sessions are available from list_listening_sessions.`
        : undefined,
  });
}

/**
 * `includeDescription` is off for lists: an author biography runs to hundreds of
 * words, and a library with 25 authors would spend most of the response on them.
 */
export function compactAuthor(
  value: unknown,
  options: CompactItemOptions = {}
): Record<string, unknown> {
  const author = rec(value);
  const items = arr(author.libraryItems);
  return defined({
    id: str(author.id),
    name: str(author.name),
    asin: str(author.asin),
    numBooks: num(author.numBooks) ?? (items.length || undefined),
    addedAt: num(author.addedAt),
    description: options.includeDescription
      ? truncateText(author.description)
      : undefined,
    libraryItems:
      items.length > 0 ? items.map((i) => compactLibraryItem(i)) : undefined,
  });
}

/**
 * How many members of a collection or playlist a *compact* projection embeds.
 *
 * `numBooks` and `numItems` already say how many there are, and neither
 * `/api/collections` nor `/api/playlists` paginates, so an unbounded embed made
 * the size of a listing a property of the instance: forty collections of three
 * hundred books is twelve thousand embedded items. Whoever wants the whole
 * membership asks for the one collection with `get_collection`, where it is a
 * single object rather than a multiplier.
 */
const COMPACT_MEMBERS = 25;

/** `[shown, note]` — the entries to embed and, if any were left out, why. */
function boundedMembers<T>(
  items: T[],
  what: string,
  followUp: string
): { shown: T[]; note?: string } {
  if (items.length <= COMPACT_MEMBERS) return { shown: items };
  return {
    shown: items.slice(0, COMPACT_MEMBERS),
    note:
      `Showing the first ${COMPACT_MEMBERS} of ${items.length} ${what}. ` +
      followUp,
  };
}

export function compactCollection(value: unknown): Record<string, unknown> {
  const collection = rec(value);
  const books = arr(collection.books);
  const { shown, note } = boundedMembers(
    books,
    'books',
    'Call get_collection with this id for the whole collection.'
  );
  return defined({
    id: str(collection.id),
    libraryId: str(collection.libraryId),
    name: str(collection.name),
    description: truncateText(collection.description),
    numBooks: books.length,
    books: shown.map((b) => compactLibraryItem(b)),
    booksTruncated: note,
    createdAt: num(collection.createdAt),
    lastUpdate: num(collection.lastUpdate),
  });
}

export function compactPlaylist(value: unknown): Record<string, unknown> {
  const playlist = rec(value);
  const items = arr(playlist.items);
  const { shown, note } = boundedMembers(
    items,
    'items',
    'Call get_playlist with this id for the whole playlist.'
  );
  return defined({
    id: str(playlist.id),
    libraryId: str(playlist.libraryId),
    name: str(playlist.name),
    description: truncateText(playlist.description),
    numItems: items.length,
    items: shown.map((entry) => {
      const item = rec(entry);
      return defined({
        libraryItemId: str(item.libraryItemId),
        episodeId: str(item.episodeId),
        libraryItem:
          item.libraryItem === undefined
            ? undefined
            : compactLibraryItem(item.libraryItem),
        episode:
          item.episode === undefined
            ? undefined
            : compactPodcastEpisode(item.episode),
      });
    }),
    itemsTruncated: note,
    createdAt: num(playlist.createdAt),
    lastUpdate: num(playlist.lastUpdate),
  });
}

/**
 * Shapes the paginated envelope of `GET /api/libraries/:id/items` and keeps the
 * paging fields, so a truncated answer can say what to call next.
 */
export function compactItemPage(
  value: unknown,
  detail: DetailLevel
): Record<string, unknown> {
  const page = rec(value);
  const results = arr(page.results);
  return defined({
    total: num(page.total),
    page: num(page.page),
    limit: num(page.limit),
    sortBy: str(page.sortBy),
    filterBy: str(page.filterBy),
    numReturned: results.length,
    results:
      detail === 'full' ? results : results.map((i) => compactLibraryItem(i)),
  });
}
