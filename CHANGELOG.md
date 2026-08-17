# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Two things read this file mechanically:
     * The release workflow extracts the section of the version being tagged with
       awk, matching "## [x.y.z]". Keep that heading shape exactly.
     * docs/reference/changelog.md includes everything from line 16 down (the
       "## [Unreleased]" heading). Adding lines above it shifts that range and the
       include fails silently — update the number there too. -->
<!-- Content starts on the next line; see the note above before inserting here. -->

## [Unreleased]

## [0.1.0] - 2026-08-17

### Added

- Initial release: MCP server for Audiobookshelf.
- 29 read tools: libraries, library items with filtering and paging, search,
  series, authors, personalized shelves, tags, genres, items, chapters, podcast
  episodes, the current user, listening progress, listening statistics, listening
  sessions, bookmarks, collections and playlists.
- 15 write tools: listening progress, bookmarks, collections and playlists.
- `AUDIOBOOKSHELF_READ_ONLY=true` registers the read tools only.
- Confirmation tokens for the irreversible operations (`delete_collection`,
  `delete_playlist`, `delete_media_progress`).
- Compact projections for every media response, with `detail: "full"` for the raw
  Audiobookshelf object.
