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

## [0.1.2] - 2026-08-18

### Fixed

- The architecture diagram no longer depends on the reader's operating system.
  It carried a `prefers-color-scheme` block, which resolves against the OS rather
  than the theme toggle of GitHub or npm — so dark-mode readers on a light OS got
  the light artwork on a dark page. The README now uses `<picture>`, which is
  resolved against the page, and the `<img>` that npm falls back to brings its own
  card instead of a media query.

### Changed

- The diagram is generated from a single source, `docs/assets/architecture.source.svg`,
  by `npm run assets`. The four rendered copies had already drifted apart; CI now
  fails if one of them is edited by hand.
- `docs/public/og.png` is generated at exactly 1280x640, GitHub's recommended size
  for a social preview, instead of being drawn by hand.

## [0.1.1] - 2026-08-17

First release published by the automated pipeline, with npm provenance.

### Added

- Multi-arch container image on GHCR (`ghcr.io/ni-c/audiobookshelf-mcp`) for
  linux/amd64 and linux/arm64, built with an SBOM and build provenance.
- Documentation site at <https://audiobookshelf-mcp.ni-c.de>, including a
  complete tool reference generated from the registered tools.
- Listed in the official MCP registry as `io.github.ni-c/audiobookshelf-mcp`.
- `SECURITY.md` with the trust model, `CONTRIBUTING.md`, and issue forms.

### Changed

- The runtime image no longer contains npm. It was only ever there because the
  base image ships it, the entrypoint is plain `node`, and the dependency tree
  npm vendors accounted for every HIGH/CRITICAL advisory Trivy reported against
  the image — none of them in this project's own dependencies.

### Fixed

- Test coverage raised from 93.9 % to 99.6 % of statements, mostly across the
  projections that absorb Audiobookshelf's varying response shapes, and the
  error paths.

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
