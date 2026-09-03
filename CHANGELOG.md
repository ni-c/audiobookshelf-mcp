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

- Every tool declares an `outputSchema` and answers with `structuredContent`
  beside the text block. A client no longer has to parse prose to use a result —
  which seven of them made unavoidable, since they answered with a sentence.

  The tools that report library metadata carry `untrusted: true` and
  `source: "audiobookshelf"` as fields, not only as a preamble in the text.
  Book descriptions pulled from metadata providers, podcast feed summaries and
  episode titles are written by someone else, so a client that reads the
  structured half must not get them unframed.

  The documents are described as open objects with the top-level keys this
  server builds. `detail: "full"` hands the API record back whole, so a strict
  shape would turn that mode into a failed call.

### Changed

- The advertised schemas avoid a spelling that is legal JSON Schema and still
  gets a tool refused, or its constraint silently dropped, by some MCP clients:
  an open object now writes `"additionalProperties": true` rather than the
  empty schema `{}` zod emits for it. What the tools accept and return is
  unchanged; only the way the schema says so is.

- `get_personalized_shelves` answers `{items: [...]}` instead of the bare array
  the API sends. A schema whose root is an array is served to a 2025-era client
  rewritten as `{result: …}`, so the tool would otherwise answer in two shapes
  depending on which revision the client spoke.

- A result too large to shrink is an error rather than an envelope saying so.
  The envelope was a different shape from what the tool declares it returns,
  which the SDK refuses.

- The two-call `confirm_token` prompt is an error result. What was asked for did
  not happen, which is what `isError` says. The text is unchanged and still
  carries the token.

- The integration compose file publishes Audiobookshelf on
  `AUDIOBOOKSHELF_PORT` (default 13378) instead of a hardcoded 13378, so a
  workstation that already runs one there does not need a patched compose file.

### Security

- **`update_collection` and `update_playlist` ask before they reorder.**
  `remove_books_from_collection` sits behind a dialog plus a token, and the
  consequence it names is not the membership — it is that "the curated order of
  the collection cannot be reconstructed from here". Reordering does exactly
  that and nothing else, and it went through with no question at all. The gate
  ran between **verbs** where the risk runs between **effects**.

  The gate is conditional on `library_item_ids` / `items` being present.
  Renaming and re-describing still ask nothing: those are recoverable by typing
  the old text back, and a dialog in front of every rename is how people learn
  to tick without reading.

  The confirmation key carries each target's **position**, not just the set:
  `setResourceKey` sorts before fingerprinting, so a bare list of ids would have
  given `[A, B]` and `[B, A]` the same key — and the order is the whole change.

  Chosen over removing the argument and adding guarded `reorder_*` tools: that
  is the same guard, two more tools, and a breaking change to a documented
  schema.

- **Five routes are exempted from that check explicitly, not by weakening it.**
  `DELETE /api/collections/{id}`, `DELETE /api/playlists/{id}`,
  `PATCH /api/me/progress/{id}`, `DELETE /api/me/progress/{id}` and
  `DELETE /api/me/item/{id}/bookmark/{time}` answer `200 text/plain "OK"` on
  2.29.0. All five are mutations whose caller ignores the value, so each says so
  at the call site. Which five could only be established against a real
  instance.

- **A 200 that is not JSON is now an error instead of an empty list.** The body
  used to be returned as a string, and a string finds neither an array nor an
  envelope in `listFrom` — so an SSO portal, a captive proxy or a misconfigured
  reverse proxy in front of the instance made `list_libraries` answer "you have
  no libraries". A swallowed error replaced by a plausible wrong answer is worse
  than an error.

  Second fuse for the same failure: the base URL is built from the parsed URL
  rather than from the raw string. `AUDIOBOOKSHELF_URL=https://abs.example.com/#dev`
  passed validation, lost everything from the `#` onwards in `fetch`, and sent
  every request — bearer token attached — to `/`, where the web UI answers 200
  with HTML. A query string went the same way one character earlier.

- **Responses are read under a 5 MB ceiling.** `content-length` is checked before
  a byte is read, and a chunked body — which declares no length — is counted
  while reading and cut off. `/api/collections` takes no paging parameters and
  embeds every book of every collection, so a shared server with forty
  collections of three hundred books answered in double-digit megabytes, which
  `response.text()` and then `JSON.parse` held about three copies of. An error
  body is still read (truncated), because the status code is the diagnostic and a
  size complaint would replace it.

### Fixed

- **A result ceiling of 100 000 bytes**, applied in `jsonResult` and
  `untrustedJsonResult` rather than per tool — so `detail: "full"`, which
  switches the compact projections off, is covered by it too. Whole entries are
  dropped, never characters: a truncated document is not a smaller answer, it is
  an unparseable one. The result carries a `truncated` block naming what to call
  instead, and the budget counts **bytes**, because a library of CJK-titled books
  is roughly three bytes per counted UTF-16 unit.

- **A compact collection or playlist embeds at most 25 members.**
  `compactCollection` mapped `books` unconditionally — not behind `detail`, not
  behind a count — and `compactPlaylist` did the same while embedding a full
  compact `libraryItem` _and_ `episode` per entry. Forty collections of three
  hundred books was twelve thousand embedded objects in one default-detail read
  tool. `numBooks` and `numItems` still report the real count, and
  `get_collection` / `get_playlist` return the whole membership for one of them.

- **`update_collection` and `update_playlist` documented an effect they do not
  have.** Both said their list argument "replaces the order completely, so it has
  to contain every item that should stay", which reads as "an item you leave out
  is removed". Measured against Audiobookshelf 2.29.0, neither can change
  membership at all:

  - `PATCH /api/collections/{id}` treats `books` as a **sort key over the rows
    the collection already has** — the controller loads them and orders them by
    `findIndex` in the payload. An id that is not in the collection is ignored,
    and a book left out gets index `-1` and moves to the **front** rather than
    being removed. A payload of ids that do not exist answers `200` and changes
    nothing.
  - `PATCH /api/playlists/{id}` refuses a list whose length differs from the
    playlist's, with `400 Invalid playlist items. Length mismatch`.

  Both descriptions now say what the arguments do, including the front-of-list
  behaviour and the 400. The integration suite pins both against a real
  instance — a stub agrees with any semantics at all, which is how this survived.

- **The README's "list tools are capped at 100 entries per call" was true for
  one tool.** Seven of the fourteen listing tools have no `limit` at all:
  `list_libraries`, `list_authors`, `list_tags`, `list_genres`,
  `list_collections`, `list_playlists` and `list_bookmarks`. The claim now says
  what holds — a response ceiling, a result ceiling and an embedded-member cap —
  and names the seven.

  No client-side `limit`/`page` was added to them: the Audiobookshelf routes
  behind those seven take no paging parameters and answer with everything at
  once, so a `page` argument would advertise server paging that does not exist
  and would refetch the whole payload for each page.

- `AUDIOBOOKSHELF_READ_ONLY` accepts `1`, `true` and `yes`, trimmed and
  case-insensitively, where it used to require the exact string `true`. It fails
  _towards_ the restriction, so `AUDIOBOOKSHELF_READ_ONLY=1` silently registering
  the write tools is the one outcome it must not have.
  `AUDIOBOOKSHELF_INSECURE_TLS` keeps the exact-match rule, for the same reason
  read the other way round.

### Added

- Tools that need a confirmation now **ask the user**, on clients that can show
  a prompt. The two-call `confirm_token` remains for clients that cannot, so
  nothing that works today stops working — but where a person can be asked, one
  is, instead of a token that only proves the same call was made twice.

- **Three more tools ask before they act**, all of which carried
  `destructiveHint: true` and went through unannounced: `delete_bookmark`,
  `remove_books_from_collection` and `remove_items_from_playlist`.

  They were exempt because they could be undone, and that turned out to be only
  half true. `add_books_to_collection` appends at the end rather than restoring
  an order. `create_bookmark` makes a new bookmark at a position, with a new
  title — the one somebody typed is gone, and the position is the only thing
  `delete_bookmark` is given, so a wrong `time` takes out a different bookmark
  than the one that was meant. And Audiobookshelf deletes a playlist outright
  once its last entry is removed, which `remove_items_from_playlist` already
  warned about _after_ the fact.

  `delete_bookmark`'s description said in so many words "No confirmation token:
  a bookmark is a position and a title, and create_bookmark restores it." It
  does not restore the title.

- `ELICITATION` switches the dialog off — `false` sends a client that could have
  been asked down the two-call-token path instead. For a scheduled job or a test
  harness, where a dialog is the wrong shape rather than an unwanted one.

  It does **not** remove the guard: there is no setting in which a guarded call
  goes unannounced. Two deliberate rough edges come with it. The variable is
  **not prefixed**, so one `export ELICITATION=false` reaches every MCP server in
  the environment — which is why a server started with it off prints a line
  saying so, and why the fallback text names the server instead of blaming a
  client that was working fine. And a value that is neither `true` nor `false`
  **stops the server**: it is the only variable here that defaults to _on_, so
  failing open on a typo would leave the dialog running while the operator
  believed it was off. It is read after the API key is wiped from the
  environment, so that exit cannot leave the key behind.

- A `docs/guide/approval.md` page, and a 👤 marker in the generated tool
  reference that is read off the registered schema rather than from a list kept
  beside it.

### Changed

- Runs on **MCP SDK 2.0**. Existing clients see the same protocol revision they
  always did; the change is the package layout behind it, and it is what lets
  the dialog above work on both protocol eras from one code path — including
  behind a stateless gateway, where the older mechanism silently fell back to
  the weaker token for every client.

- The linter is **oxlint** instead of eslint plus typescript-eslint, which
  lifts the TypeScript ceiling: typescript-eslint pins `typescript` below 6.1,
  so this repository was held on TypeScript 6 by its linter rather than by its
  code.

- The tool filter, the confirmation store, the host classifier and the
  documentation-asset generator now come from **`mcp-tool-allowlist`**,
  **`mcp-approval`**, **`mcp-internal-hosts`** and **`svg-asset-set`** rather
  than from copies kept here — 872 fewer lines, and one place to fix each. None
  of them has a runtime dependency of its own.

- The shared libraries move to `mcp-approval` 0.7.1, `mcp-tool-allowlist` 0.2.1,
  `mcp-internal-hosts` 0.2.1, `mcp-integration-harness` 0.2.0 and
  `svg-asset-set` 0.2.0.

- `SECURITY.md` now says what the confirmation **proves**: binding to one
  operation with one set of arguments, not freshness. No replay defence is built,
  because the sealing key is per process, the token is single-use, and
  `requestState` only crosses the wire on protocol revision `2026-07-28`, which
  this server does not offer — it takes the SDK's default list, which ends at
  `2025-11-25`. The section names what would have to change for that to stop
  being true.

- stdio is served through `serveStdio`, so the connection's era is negotiated
  on the opening exchange rather than assumed. A client that pins the
  `2026-07-28` era is served it; until now its `server/discover` probe was
  answered with "Method not found" and only `2025-11-25` was on offer. A client
  that speaks the older era sees no change — it is still pinned to one instance
  for the life of the connection, exactly as a hand-wired
  `StdioServerTransport` served it.

### Fixed

- Confirmation tokens are compared with a **constant-time** comparison. The
  copy in this repository used `!==`, which leaks through timing how much of a
  guess was right. Reaching a token still requires having received it in a
  previous tool result, so this closes a margin rather than a hole.

- An entry in `AUDIOBOOKSHELF_ALLOW_TOOLS` that is not tool-name-shaped is now
  **redacted** in the error rather than quoted back. `AUDIOBOOKSHELF_API_KEY`
  and `AUDIOBOOKSHELF_ALLOW_TOOLS` are adjacent lines in every compose file,
  and a paste into the wrong one used to print the credential into the client's
  log.

## [0.2.0] - 2026-08-27

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

### Changed

- The README now carries the same eight badges, in the same order, as every other
  MCP server in this family, all of them reading from npm rather than hard-coded;
  the opening follows one shape; and the standalone "Full documentation" line is
  gone, because the docs badge three lines above it points at the same page.

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
