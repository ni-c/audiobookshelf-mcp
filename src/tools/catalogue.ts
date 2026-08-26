/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* anything is registered — and in read-only mode the write tools are
 * never registered at all. Deriving the catalogue from what actually reached
 * `registerTool` would make `AUDIOBOOKSHELF_ALLOW_TOOLS=add_books_to_collection` report
 * "unknown tool" under `AUDIOBOOKSHELF_READ_ONLY=true`, which is the one answer that
 * is wrong.
 *
 * This is also the full tool surface, hard-coded on purpose: a tool that appears
 * or disappears by accident is a change to the server's contract and has to be a
 * deliberate edit here. `test/tool-filter.test.ts` asserts that these lists and
 * the tools the server really registers are the same set.
 */

/** Registered always. Every one carries `readOnlyHint: true`. */
export const READ_TOOLS = [
  'get_author',
  'get_collection',
  'get_item_chapters',
  'get_library',
  'get_library_filter_data',
  'get_library_item',
  'get_library_stats',
  'get_listening_stats',
  'get_me',
  'get_media_progress',
  'get_personalized_shelves',
  'get_playlist',
  'get_podcast_episode',
  'get_series',
  'get_server_status',
  'get_year_stats',
  'list_authors',
  'list_bookmarks',
  'list_collections',
  'list_genres',
  'list_items_in_progress',
  'list_libraries',
  'list_library_items',
  'list_listening_sessions',
  'list_playlists',
  'list_recent_episodes',
  'list_series',
  'list_tags',
  'search_library',
] as const;

/** Registered unless `AUDIOBOOKSHELF_READ_ONLY` is set. */
export const WRITE_TOOLS = [
  'add_books_to_collection',
  'add_items_to_playlist',
  'create_bookmark',
  'create_collection',
  'create_playlist',
  'delete_bookmark',
  'delete_collection',
  'delete_media_progress',
  'delete_playlist',
  'remove_books_from_collection',
  'remove_items_from_playlist',
  'set_media_progress',
  'update_bookmark',
  'update_collection',
  'update_playlist',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * What `AUDIOBOOKSHELF_ALLOW_TOOLS=essential` selects: find, inspect, resume.
 *
 * 8 of 44. Left out on purpose: the collection, playlist and bookmark CRUD, and every statistics tool —
 * organisational and retrospective rather than operational.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'list_libraries',
  'search_library',
  'list_library_items',
  'get_library_item',
  'get_item_chapters',
  'list_items_in_progress',
  'get_media_progress',
  'set_media_progress',
];
