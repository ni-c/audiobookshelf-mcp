# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Two things read this file mechanically:
     * The release workflow extracts the section of the version being tagged with
       awk, matching "## [x.y.z]". Keep that heading shape exactly.
     * docs/reference/changelog.md includes everything between the region markers
       below, by name rather than by line range, so the header above can grow
       freely. Keep the end marker last in the file, after the link definitions. -->

<!-- #region changelog -->

## [Unreleased]

### Added

- `AUDIOBOOKSHELF_ALLOW_TOOLS` and `AUDIOBOOKSHELF_DENY_TOOLS` choose which of the 44
  tools are registered. Both take comma-separated tool names or a prefix with a
  trailing `*`, the allow list decides what is in and the deny list is subtracted
  from it, and `AUDIOBOOKSHELF_ALLOW_TOOLS=essential` selects a curated eight —
  `list_libraries`, `search_library`, `list_library_items`, `get_library_item`, `get_item_chapters`, `list_items_in_progress`, `get_media_progress`, `set_media_progress`. A model picks the right tool far more reliably from eight than
  from forty-four, and every visible tool costs context on every request. Nothing
  changes for an installation that sets neither.

  A filtered tool is not registered at all, so it is absent from `tools/list`
  and answers `tools/call` with "tool not found" — the same cut
  `AUDIOBOOKSHELF_READ_ONLY` already makes, not a second, weaker one.

  An entry that matches no tool **stops the server at startup**, naming the
  entry and listing the real names, rather than being ignored: an ignored typo
  leaves a tool missing from `tools/list` with nothing pointing at the cause.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.1.4] - 2026-08-26

### Changed

- The check that decides whether `AUDIOBOOKSHELF_URL` points somewhere local — and
  therefore whether sending a credential over plain `http` is worth warning
  about — now uses the same host classifier as the other MCP servers in this
  family, in `src/hosts.ts`. The string comparison it replaces missed several
  spellings of the same address: `http://[::ffff:127.0.0.1]`, which `URL`
  canonicalises to `[::ffff:7f00:1]` before any check sees it, and `localhost.`
  with its root label. It also treated `127.example.com` as loopback, because it
  matched on the `127.` prefix, and so stayed quiet about a plain-http URL to a
  public host.

Nothing else changes: this server has no tool that takes a URL, so there is no
request whose target a caller can choose.

## [0.1.3] - 2026-08-18

### Fixed

- The API key is no longer left in the environment when `AUDIOBOOKSHELF_URL` is
  unset. `loadConfig` deleted it only at the very end, behind the early return
  for a missing URL, so in that state the key stayed in `process.env` for the
  whole process lifetime — readable in `/proc/<pid>/environ` and inherited by
  every child process. The deletion now happens before any branch.
- A malformed `AUDIOBOOKSHELF_URL` is no longer echoed into the log. That branch
  fires precisely when the variable does not hold a URL, which most often means
  the API key was pasted into the wrong variable.
- `http://[::1]:…` no longer produces the "plain http to a non-local host"
  warning. `URL.hostname` keeps the brackets around an IPv6 literal, so the
  loopback check never matched that notation.

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

<!-- #endregion changelog -->
