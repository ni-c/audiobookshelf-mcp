# audiobookshelf-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/audiobookshelf-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/audiobookshelf-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/audiobookshelf-mcp)](https://www.npmjs.com/package/audiobookshelf-mcp)
[![npm downloads](https://img.shields.io/npm/dm/audiobookshelf-mcp)](https://www.npmjs.com/package/audiobookshelf-mcp)
[![node](https://img.shields.io/node/v/audiobookshelf-mcp)](https://nodejs.org)
[![Container](https://img.shields.io/badge/ghcr.io-ni--c%2Faudiobookshelf--mcp-2496ED?logo=docker&logoColor=white)](https://github.com/ni-c/audiobookshelf-mcp/pkgs/container/audiobookshelf-mcp)
[![license](https://img.shields.io/npm/l/audiobookshelf-mcp)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-audiobookshelf--mcp.ni--c.de-4f46e5)](https://audiobookshelf-mcp.ni-c.de)

An [MCP](https://modelcontextprotocol.io) server for
[Audiobookshelf](https://www.audiobookshelf.org/), the self-hosted audiobook and
podcast server. It lets an AI assistant browse your libraries, answer questions
about what you own and what you have listened to, and — unless you switch it off —
keep your listening progress, bookmarks, collections and playlists up to date.

44 tools: 29 read, 15 write.

📖 **Full documentation: <https://audiobookshelf-mcp.ni-c.de>**

<img src="https://audiobookshelf-mcp.ni-c.de/architecture.svg" alt="An MCP client talks to audiobookshelf-mcp over stdio; the server exposes 29 read and 15 write tools, compacts every response, and calls the Audiobookshelf REST API over HTTPS with a bearer API key" width="800">

<img src="https://audiobookshelf-mcp.ni-c.de/demo.gif" alt="Terminal recording: the server reports 44 tools, lists library items as a compact projection, and answers the first delete_collection call with a single-use confirmation token instead of deleting anything" width="800">

## Requirements

- Node.js 22 or newer
- Audiobookshelf **2.26.0 or newer** — earlier versions have no API keys
- An Audiobookshelf API key

## Getting an API key

API keys are managed by an admin under **Settings → Users → API Keys**. A key acts
on behalf of exactly one Audiobookshelf user and inherits that user's permissions,
so a key issued for a normal account cannot see libraries that account cannot see,
and cannot delete anything unless that account may delete. The key is shown only
once, at creation.

## Configuration

| Variable                      | Required | Description                                                                             |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `AUDIOBOOKSHELF_URL`          | yes      | Base URL of the instance, e.g. `https://abs.example.com`. Must not contain credentials. |
| `AUDIOBOOKSHELF_API_KEY`      | yes      | API key, sent as `Authorization: Bearer …`                                              |
| `AUDIOBOOKSHELF_READ_ONLY`    | no       | `true` registers only the 29 read tools                                                 |
| `AUDIOBOOKSHELF_INSECURE_TLS` | no       | `true` accepts self-signed certificates — scoped to this connection, not process-wide   |

The server starts without configuration: it completes the MCP handshake and lists
its tools, and every call then fails with the setup instructions. That is
deliberate, so registries and sandbox inspectors can introspect it.

## Install

```sh
claude mcp add audiobookshelf \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  -- npx -y audiobookshelf-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "audiobookshelf": {
      "command": "npx",
      "args": ["-y", "audiobookshelf-mcp"],
      "env": {
        "AUDIOBOOKSHELF_URL": "https://abs.example.com",
        "AUDIOBOOKSHELF_API_KEY": "…"
      }
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.audiobookshelf]
command = "npx"
args = ["-y", "audiobookshelf-mcp"]
env = { AUDIOBOOKSHELF_URL = "https://abs.example.com", AUDIOBOOKSHELF_API_KEY = "…" }
```

Container (multi-arch, with SBOM and build provenance):

```sh
docker run -i --rm \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  ghcr.io/ni-c/audiobookshelf-mcp
```

`-i` is required — the protocol runs over stdin and stdout. There is no port to
publish. More client recipes, including how to keep the key off the `docker run`
command line, are in the
[client guide](https://audiobookshelf-mcp.ni-c.de/guide/clients).

## Tools

### Reading

| Tool                                  | What it does                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `list_libraries`                      | The accessible libraries with id, name and media type — the entry point                             |
| `get_library`                         | One library with its folders and settings                                                           |
| `get_library_stats`                   | Item, author and genre counts, total duration and size                                              |
| `get_library_filter_data`             | The filterable values of a library: authors, genres, tags, series, narrators, languages, publishers |
| `list_library_items`                  | Items of a library, paginated, sortable, filterable                                                 |
| `search_library`                      | Full-text search across books, podcasts, series, authors, narrators and tags                        |
| `get_personalized_shelves`            | The home screen shelves: Continue Listening, Recently Added, …                                      |
| `list_series` / `get_series`          | Series with book count and total duration                                                           |
| `list_authors` / `get_author`         | Authors, optionally with their items                                                                |
| `list_tags` / `list_genres`           | All tags / genres used on the server                                                                |
| `get_library_item`                    | One book or podcast with metadata, tags and your progress                                           |
| `get_item_chapters`                   | The chapter list of a book, separate because it can be long                                         |
| `get_podcast_episode`                 | One episode with publication date, duration and description                                         |
| `list_recent_episodes`                | Newest episodes of a podcast library                                                                |
| `get_me`                              | The user the API key acts for, with permissions and libraries                                       |
| `list_items_in_progress`              | Started but unfinished items across all libraries                                                   |
| `get_media_progress`                  | Position, percentage and finished state for one item                                                |
| `get_listening_stats`                 | Total time, time per day and per weekday, most listened items                                       |
| `get_year_stats`                      | The "year in review" figures for one calendar year                                                  |
| `list_listening_sessions`             | Playback sessions with device, position and time listened                                           |
| `list_bookmarks`                      | Bookmarks, all of them or those of one item                                                         |
| `list_collections` / `get_collection` | Collections — shared, ordered groups of books                                                       |
| `list_playlists` / `get_playlist`     | Playlists — private per user, books or episodes                                                     |
| `get_server_status`                   | Version and initialization state of the server                                                      |

### Writing

| Tool                                                            | What it does                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `set_media_progress`                                            | Set position, mark finished or unfinished, hide from Continue Listening |
| `delete_media_progress`                                         | Delete a progress record — needs a confirmation token                   |
| `create_bookmark` / `update_bookmark` / `delete_bookmark`       | Named positions in a book                                               |
| `create_collection` / `update_collection` / `delete_collection` | Collections; delete needs a confirmation token                          |
| `add_books_to_collection` / `remove_books_from_collection`      | Collection membership                                                   |
| `create_playlist` / `update_playlist` / `delete_playlist`       | Playlists; delete needs a confirmation token                            |
| `add_items_to_playlist` / `remove_items_from_playlist`          | Playlist membership                                                     |

### Response size

Audiobookshelf returns very large objects — an expanded library item carries every
audio file, track and chapter with full ffprobe metadata. Every tool that returns
media therefore answers with a compact projection by default and accepts
`detail: "full"` for the raw object. List tools are capped at 100 entries per call
and say how to page on when more match.

### Filtering

`list_library_items` takes `filter_group` plus `filter_value` and builds the
base64-encoded `filter` parameter the API expects. The valid values come from
`get_library_filter_data`. A valued group without a value is rejected, because
Audiobookshelf would silently answer with the _unfiltered_ library instead.

```
filter_group="authors",  filter_value="<author id>"
filter_group="progress", filter_value="finished" | "in-progress" | "not-started" | "not-finished"
filter_group="issues"    (standalone, no value)
```

## Safety

- **Read-only mode.** `AUDIOBOOKSHELF_READ_ONLY=true` does not register the write
  tools at all, rather than refusing them at call time.
- **Confirmation tokens.** `delete_collection`, `delete_playlist` and
  `delete_media_progress` answer the first call with a single-use token that is
  bound to the target id and expires after five minutes; only a second call
  carrying that token performs the deletion. A plain `confirm: true` flag could be
  set by the model on the first try, or be talked into it by text coming out of
  the library. Operations that are cheap to undo — removing an item from a
  collection, deleting a bookmark — are marked destructive but do not require a
  token.
- **Confirmation prompts never quote API content.** Collection and playlist names
  are user-supplied text and are read by a model, so the prompts name only ids.
- **Untrusted content is marked.** Book descriptions come from metadata providers
  and podcast summaries come from RSS feeds — third parties write them. Every
  result carrying such content is labelled as data, not instructions.
- **The API key is deleted from the environment** once the configuration has been
  read, so it is not visible to child processes or in `/proc/<pid>/environ`.
- **No redirects are followed** (`redirect: 'error'`), so the `Authorization`
  header cannot be replayed against another host, and every request has a 15
  second timeout.
- **Ids are validated** before they enter a URL path.
- **Upstream error bodies are sanitized**: HTML error pages are dropped, anything
  else is truncated to 2000 characters.
- **Progress updates send whitelisted fields only.** The Audiobookshelf endpoint
  applies its payload to the progress record wholesale.
- **What this server cannot do**, by design: no user management, no server
  settings, no backups, no cache purging, no filesystem browsing, no library or
  item deletion, no metadata rewriting, no file uploads.

One caveat that comes from Audiobookshelf itself: removing the _last_ entry from a
playlist deletes the playlist. `remove_items_from_playlist` says so in its result
when it happens.

## Development

```sh
npm install
npm run lint          # eslint + prettier --check
npm run build         # tsc
npm test              # vitest
npm run test:coverage # with thresholds
npm run docs:tools    # regenerate docs/reference/tools.md from the registered tools
```

The table above is hand-curated; the complete
[tool reference](https://audiobookshelf-mcp.ni-c.de/reference/tools) with every
parameter is generated from the code, and CI fails if the committed copy is stale.
See [CONTRIBUTING.md](CONTRIBUTING.md) for a throwaway Audiobookshelf you can
safely write to — the write tools change progress and bookmarks on the API key's
own user, so don't develop against a library you care about.

The tool definitions were derived from the Audiobookshelf server source
(`server/routers/ApiRouter.js` and the controllers) rather than from
[api.audiobookshelf.org](https://api.audiobookshelf.org/), which is out of date in
several places — the filter data endpoint is `/filterdata` not `/filter`, progress
updates are `PATCH /api/me/progress/:id` not `POST /api/me/progress`, and bookmarks
live under `/api/me/item/:id/bookmark`.

## Releasing

Tag-driven, no manual publish step:

1. Move the `[Unreleased]` entries into a new `## [x.y.z] - YYYY-MM-DD` section in
   `CHANGELOG.md` and bump `package.json`.
2. `npm run lint && npm run build && npm run test:coverage`.
3. Commit, then a **signed annotated** tag: `git tag -s vx.y.z -m "vx.y.z"`.
4. `git push origin main vx.y.z`.

`release.yml` then runs the tests, publishes to npm with provenance via Trusted
Publishing (no token secret involved), creates the GitHub release from the
CHANGELOG section, and publishes to the
[MCP registry](https://registry.modelcontextprotocol.io) as
`io.github.ni-c/audiobookshelf-mcp`. `ci.yml` pushes the multi-arch image to GHCR
on the same tag.

If the registry step fails, fix it on `main` and dispatch the
`Publish to MCP Registry` workflow — do **not** re-run the tag job, which would
check out the old tree.

## Contributing

Issues, discussions and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). For vulnerabilities please use
[private reporting](https://github.com/ni-c/audiobookshelf-mcp/security/advisories/new)
rather than a public issue; the policy is in [SECURITY.md](SECURITY.md).

## License

MIT
