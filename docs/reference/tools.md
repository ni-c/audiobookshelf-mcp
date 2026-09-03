<!--
  GENERATED FILE — do not edit by hand.
  Regenerate with: npm run build && npm run docs:tools
  The CI test job fails when this file is out of date.
-->

# Tool reference

All 44 tools: 29 read, 15 write.
With `AUDIOBOOKSHELF_READ_ONLY=true` the write tools are not registered at all.

All 44 are registered unless you say otherwise. `AUDIOBOOKSHELF_ALLOW_TOOLS`
and `AUDIOBOOKSHELF_DENY_TOOLS` narrow the list to the ones you want, and
`AUDIOBOOKSHELF_ALLOW_TOOLS=essential` selects the 8 marked **essential**
below — see [choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Every tool that returns media accepts `detail` — `"compact"` (the default)
returns a projection with the fields that matter for browsing, `"full"`
returns the raw Audiobookshelf object, which is very large.

👤 marks a tool that **asks a person** before it acts, through MCP
elicitation — a dialog the model cannot answer on its behalf. Where the
client cannot show one, it falls back to a two-call `confirm_token`, and
says which of the two it was. `ELICITATION=false` takes that fallback
deliberately; it never removes the guard. See
[Asking a person](/guide/approval).

Every tool declares all four MCP annotations — `readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint`. They are a hint a
client may ignore; the dialog is enforced here and cannot be.

Every tool declares an `outputSchema` and answers with `structuredContent` beside
the text block, so a client can use a result without parsing prose. The tools
that report library metadata carry `untrusted: true` and
`source: "audiobookshelf"` as fields of that object. The documents are described
as open objects with the top-level keys this server builds: `detail: "full"`
hands the API record back whole, so a strict shape would turn that mode into a
failed call.

## Read tools

### `list_libraries`

**List libraries** — read-only, **essential**

Lists the Audiobookshelf libraries the API key’s user can access, with their id, name and media type (book or podcast). Start here — every other library tool needs a library id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_library`

**Get library** — read-only

Fetches a single library including its folders and scanner settings.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_library_stats`

**Get library stats** — read-only

Statistics for one library: number of items, authors and genres, total duration and size, longest and largest items.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |

### `get_library_filter_data`

**Get library filter data** — read-only

Returns the values that can be filtered on in this library: authors, genres, tags, series, narrators, languages and publishers, each with the id or name to pass to list_library_items as filter_value.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |

### `list_library_items`

**List library items** — read-only, **essential**

Lists items (books or podcasts) of a library, paginated, sortable and filterable. Use get_library_filter_data first to learn the valid filter values. Filter groups — valued (need filter_value): genres, tags, series, authors, progress, narrators, publishers, publishedDecades, missing, languages, tracks, ebooks; standalone: issues, feed-open, share-open, recent.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `page` | integer | no | 0-based page number, default 0 |
| `limit` | integer | no | Number of entries to return, default 25, max 100 |
| `sort` | string | no | Sort key in dot notation. Common values: media.metadata.title, media.metadata.authorName, media.metadata.publishedYear, media.duration, birthtimeMs, addedAt, size, progress, random. |
| `descending` | boolean | no | Reverse the sort order, default false |
| `filter_group` | `"genres"` \| `"tags"` \| `"series"` \| `"authors"` \| `"progress"` \| `"narrators"` \| `"publishers"` \| `"publishedDecades"` \| `"missing"` \| `"languages"` \| `"tracks"` \| `"ebooks"` \| `"issues"` \| `"feed-open"` \| `"share-open"` \| `"recent"` | no | Filter group. The server encodes group and value into the base64 form its API expects. |
| `filter_value` | string | no | Value for filter_group: an id for authors/series, a name for genres/tags/narrators/languages/publishers, one of finished/in-progress/not-started/not-finished for progress. Must be omitted for the standalone groups. |
| `collapse_series` | boolean | no | Collapse books of the same series into one entry |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `search_library`

**Search a library** — read-only, **essential**

Full-text search within one library. Matches books, podcasts, series, authors, narrators and tags. Use this for "do I own X?" questions; use list_library_items with a filter for "show me all X" questions.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `q` | string | yes | Search query |
| `limit` | integer | no | Number of entries to return, default 12, max 100 |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_personalized_shelves`

**Get personalized shelves** — read-only

The shelves of the Audiobookshelf home screen for this user: Continue Listening, Continue Series, Recently Added, Newest Episodes, Listen Again and so on. The fastest answer to "what am I listening to right now?".

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `limit` | integer | no | Number of entries to return, default 10, max 100 |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_series`

**List series** — read-only

Lists the series of a book library with their number of books and total duration. To list the books of one series, call list_library_items with filter_group="series" and filter_value=&lt;series id&gt;.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `page` | integer | no | 0-based page number, default 0 |
| `limit` | integer | no | Number of entries to return, default 25, max 100 |
| `sort` | string | no | Sort key, e.g. name, numBooks, addedAt, totalDuration |
| `descending` | boolean | no | Reverse the sort order |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_series`

**Get series** — read-only

Fetches a single series by id, including its books. To list the books with paging and sorting, use list_library_items with filter_group="series" instead.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `series_id` | string | yes | Series id |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_authors`

**List authors** — read-only

Lists all authors of a book library with their number of books. To list the books of one author, call list_library_items with filter_group="authors" and filter_value=&lt;author id&gt;.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library id, as returned by list_libraries |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_author`

**Get author** — read-only

Fetches a single author, optionally with the library items attributed to them.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `author_id` | string | yes | Author id |
| `include_items` | boolean | no | Also return the author’s library items, default false |
| `library_id` | string | no | Restrict the returned items to this library |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_tags`

**List tags** — read-only

Lists all tags used on the server, across libraries. Tags are the user-defined labels on library items.

Takes no parameters.

### `list_genres`

**List genres** — read-only

Lists all genres used on the server, across libraries. Genres come from the media metadata, not from the user.

Takes no parameters.

### `get_server_status`

**Get server status** — read-only

Version and initialization state of the Audiobookshelf server. Useful to check connectivity and whether the server is new enough for API keys (2.26.0 or later).

Takes no parameters.

### `get_library_item`

**Get library item** — read-only, **essential**

Fetches one book or podcast including its metadata, tags and the listening progress of the API key’s user. Chapters, audio files and tracks are not part of the compact projection — use get_item_chapters for chapters, or detail="full" for everything.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_item_chapters`

**Get item chapters** — read-only, **essential**

Returns the chapter list of a book with start and end times in seconds. Separate from get_library_item because long audiobooks can have hundreds of chapters.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |

### `get_podcast_episode`

**Get podcast episode** — read-only

Fetches one podcast episode with its publication date, duration and description.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id of the podcast the episode belongs to |
| `episode_id` | string | yes | Podcast episode id |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_recent_episodes`

**List recent podcast episodes** — read-only

Lists the most recently published episodes across a podcast library — the "Newest Episodes" view. Only works on libraries with mediaType "podcast".

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Id of a podcast library |
| `page` | integer | no | 0-based page number, default 0 |
| `limit` | integer | no | Episodes per page, default 25, max 100 |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_me`

**Get the current user** — read-only

Returns the Audiobookshelf user the API key acts on behalf of, with their permissions and accessible libraries. The compact projection reports media progress and bookmarks as counts — the full user object embeds every single one of them.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_items_in_progress`

**List items in progress** — read-only, **essential**

The items the user has started but not finished, newest first — the "Continue Listening" list across all libraries. The entries carry progressLastUpdate but not the position itself; use get_media_progress for that. For podcasts, recentEpisode names the episode in progress.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | integer | no | Number of entries to return, default 25, max 100 |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_media_progress`

**Get media progress** — read-only, **essential**

The listening progress of the current user for one book or podcast episode: position, percentage and whether it is finished. Returns a 404 error when the item has never been started.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `episode_id` | string | no | Podcast episode id — required for podcast episodes, omitted for books |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_listening_stats`

**Get listening stats** — read-only

Aggregated listening statistics of the current user: total time, time per weekday, the last 30 days, the ten most listened items and the ten most recent sessions. detail="full" returns the complete per-day history and the full metadata of every item ever listened to, which is the largest response this API produces.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_year_stats`

**Get stats for a year** — read-only

The "year in review" statistics of the current user for one calendar year: books finished, time listened, top authors and genres.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `year` | integer | yes | Calendar year, e.g. 2026 |

### `list_listening_sessions`

**List listening sessions** — read-only

The playback sessions of the current user, newest first — each entry is one listening stretch with device, position and time listened.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `page` | integer | no | 0-based page number, default 0 |
| `limit` | integer | no | Number of entries to return, default 10, max 100 |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_bookmarks`

**List bookmarks** — read-only

The bookmarks of the current user — either all of them, or those of one library item. A bookmark is a named position in seconds. Audiobookshelf has no bookmarks endpoint: they are a field on the account, so this reads /api/me and filters here. That is why there is no pagination — you get all of them.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | no | Restrict the result to the bookmarks of this library item |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_collections`

**List collections** — read-only

Lists collections — the curated, ordered groups of books. Without library_id it returns the collections of every accessible library. Collections are shared server-wide; playlists are private per user.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | no | Restrict the result to this library |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_collection`

**Get collection** — read-only

Fetches one collection with the books it contains, in order.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | string | yes | Collection id, as returned by list_collections |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `list_playlists`

**List playlists** — read-only

Lists the playlists of the API key’s user. Without library_id it returns the playlists of every accessible library. Playlists are private per user and can hold books or podcast episodes; collections are shared server-wide and hold books only.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | no | Restrict the result to this library |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

### `get_playlist`

**Get playlist** — read-only

Fetches one playlist with its entries, in order.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `playlist_id` | string | yes | Playlist id, as returned by list_playlists |
| `detail` | `"compact"` \| `"full"` | no | "compact" (default) returns a projection with the fields that matter for browsing; "full" returns the raw Audiobookshelf object including audio files, tracks and chapters, which is very large. |

## Write tools

### `set_media_progress`

**Set media progress** — write, **essential**

Creates or updates the listening progress of the API key’s user for one book or podcast episode. Set is_finished=true to mark it as finished, is_finished=false to reopen it (which resets the position to 0), or current_time to jump to a position in seconds. Audiobookshelf also marks an item finished on its own once less than ten seconds remain.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `episode_id` | string | no | Podcast episode id — required to address a podcast episode, omitted for books |
| `current_time` | number | no | New playback position in seconds |
| `progress` | number | no | Progress as a fraction between 0 and 1. Only used when is_finished is not given. |
| `is_finished` | boolean | no | Mark the item as finished (true) or unfinished (false) |
| `hide_from_continue_listening` | boolean | no | Hide the item from the "Continue Listening" shelf without changing its position |

### `delete_media_progress` 👤

**Delete media progress** — write, destructive

Deletes a progress record of the API key’s user, which removes the listening history for that item — position, finished state and dates. Takes the media progress id (field "id" of get_media_progress), not the library item id. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `media_progress_id` | string | yes | Media progress id, from the "id" field of get_media_progress |
| `confirm_token` | string | no | Token from the first call of this tool |

### `create_bookmark`

**Create bookmark** — write

Creates a bookmark at a position of a book for the API key’s user. The position in seconds is the bookmark’s identity — a second bookmark at the same second is rejected.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `time` | number | yes | Position in seconds where the bookmark is placed |
| `title` | string | yes | Bookmark title |

### `update_bookmark`

**Update bookmark** — write, destructive

Renames the bookmark at a given position. The position itself cannot be changed — delete the bookmark and create a new one for that.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `time` | number | yes | Position in seconds identifying the bookmark |
| `title` | string | yes | New bookmark title |

### `delete_bookmark` 👤

**Delete bookmark** — write, destructive

Deletes the bookmark at a given position. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_item_id` | string | yes | Library item id, as returned by list_library_items or search_library |
| `time` | number | yes | Position in seconds identifying the bookmark |
| `confirm_token` | string | no | Token from the first call of this tool |

### `create_collection`

**Create collection** — write

Creates a collection of books. Audiobookshelf rejects empty collections, so at least one library item id is required, and every item must be a book from the given library.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library the collection belongs to |
| `name` | string | yes | Collection name |
| `description` | string | no | Optional description |
| `library_item_ids` | string[] | yes | Library item ids of books |

### `update_collection` 👤

**Update collection** — write, destructive

Renames a collection, changes its description or reorders its books. library_item_ids ONLY REORDERS. It cannot add or remove anything: Audiobookshelf sorts the books the collection already has by their position in this list, so an id that is not currently in the collection is ignored, and a book you leave out is not removed — it moves to the FRONT. Pass every current book, in the order you want. Use add_books_to_collection and remove_books_from_collection to change membership. Reordering asks a person first, because the order somebody arranged cannot be reconstructed afterwards; renaming and re-describing do not. Where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | string | yes | Collection id, as returned by list_collections |
| `name` | string | no | New name |
| `description` | string | no | New description |
| `library_item_ids` | string[] | no | The books the collection already has, in the order you want them. Reorders only — it adds nothing and removes nothing. |
| `confirm_token` | string | no | Token from the first call of this tool |

### `add_books_to_collection`

**Add books to collection** — write

Adds one or more books to an existing collection. Books already in the collection are ignored; books from a different library are rejected.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | string | yes | Collection id, as returned by list_collections |
| `library_item_ids` | string[] | yes | Library item ids of books |

### `remove_books_from_collection` 👤

**Remove books from collection** — write, destructive

Removes books from a collection. The books themselves are untouched — only their membership in the collection ends, and it can be restored with add_books_to_collection. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | string | yes | Collection id, as returned by list_collections |
| `library_item_ids` | string[] | yes | Library item ids of books |
| `confirm_token` | string | no | Token from the first call of this tool |

### `delete_collection` 👤

**Delete collection** — write, destructive

Deletes a collection. The books stay in the library, but the curated list and its order are gone. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it. Requires an Audiobookshelf account with delete permission.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collection_id` | string | yes | Collection id, as returned by list_collections |
| `confirm_token` | string | no | Token from the first call of this tool |

### `create_playlist`

**Create playlist** — write

Creates a playlist for the API key’s user. Unlike a collection it may start out empty and it may hold podcast episodes.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `library_id` | string | yes | Library the playlist belongs to |
| `name` | string | yes | Playlist name |
| `description` | string | no | Optional description |
| `items` | object[] | no | Initial entries, optional |

### `update_playlist` 👤

**Update playlist** — write, destructive

Renames a playlist, changes its description or reorders its entries. items ONLY REORDERS. It cannot add or remove anything, and it must contain EXACTLY the entries the playlist already has: Audiobookshelf refuses a list of a different length with HTTP 400 "Invalid playlist items. Length mismatch". Read the current entries with get_playlist first, then send them in the order you want. Use add_items_to_playlist and remove_items_from_playlist to change membership. The library of a playlist cannot be changed. Reordering asks a person first, because the order somebody arranged cannot be reconstructed afterwards; renaming and re-describing do not. Where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `playlist_id` | string | yes | Playlist id, as returned by list_playlists |
| `name` | string | no | New name |
| `description` | string | no | New description |
| `items` | object[] | no | Exactly the entries the playlist already has, in the order you want them. Reorders only; a list of a different length is refused with HTTP 400. |
| `confirm_token` | string | no | Token from the first call of this tool |

### `add_items_to_playlist`

**Add items to playlist** — write

Appends books or podcast episodes to a playlist. All entries must come from the playlist’s library and match its kind — a podcast playlist needs an episode_id on every entry, a book playlist on none.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `playlist_id` | string | yes | Playlist id, as returned by list_playlists |
| `items` | object[] | yes |  |

### `remove_items_from_playlist` 👤

**Remove items from playlist** — write, destructive

Removes entries from a playlist. The media itself is untouched and the entries can be added back with add_items_to_playlist. Note that Audiobookshelf deletes a playlist automatically once its last entry is removed. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `playlist_id` | string | yes | Playlist id, as returned by list_playlists |
| `items` | object[] | yes |  |
| `confirm_token` | string | no | Token from the first call of this tool |

### `delete_playlist` 👤

**Delete playlist** — write, destructive

Deletes a playlist. The media stays in the library. Asks a person first; where the client cannot show a dialog, call once to receive a token and again with it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `playlist_id` | string | yes | Playlist id, as returned by list_playlists |
| `confirm_token` | string | no | Token from the first call of this tool |
