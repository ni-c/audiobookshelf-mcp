# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/audiobookshelf-mcp.git && cd audiobookshelf-mcp
npm install
npm test              # vitest, no network — every API call is stubbed
npm run build
npm run test:coverage # with the thresholds CI enforces
```

## Running the integration suite

The unit tests stub `fetch`. The integration suite spawns the built server over
stdio against a throwaway Audiobookshelf in Docker and calls **every tool in the
catalogue** — against a library Audiobookshelf scanned itself, so the durations,
track counts and authors are what it made of real files rather than what a
fixture claimed.

```sh
npm run build     # the suite runs dist/index.js, not src/
docker compose -f test/integration/compose.yml up -d
npm run test:integration
docker compose -f test/integration/compose.yml down -v
```

**41 of 44 tools.** The three excused ones carry written reasons: two need a
podcast library, which needs a real feed to download episodes from, and
`get_series` needs a series, which Audiobookshelf derives from the directory
layout — adding a series folder would test the fixture rather than the tool.

The library is a **fixture in the repository**: two audiobooks of near-silence,
about 24 kB, generated with Python's `wave` module. Audiobookshelf scans a
directory, so a library cannot be created empty and filled through the API.

Five things about driving it headlessly, all in `bootstrap.ts`:

- **`POST /init`** creates the first account and answers the string `OK` rather
  than JSON. There is no environment variable that seeds an admin.
- **`POST /login`** returns the token under `user.accessToken`, not at the top
  level.
- **`POST /api/api-keys` requires `userId`.** Without it the answer is a bare
  `Bad Request` naming no field. API keys need **2.26.0** or newer; before that
  the only credential is the login token, which expires.
- **Creating a library does not scan it.** It starts a _watcher_, which notices
  future changes and does nothing about what is already there — so the library
  exists and stays empty for ever, which reads like the files being unreadable.
  The scan has to be asked for, and it is asynchronous.
- **`/api/me/bookmarks` does not exist**, with or without an item id after it.
  Bookmarks are a field on the account, which is why `list_bookmarks` reads
  `/api/me` and filters here.

Please do not develop against an Audiobookshelf holding data you care about: the
write tools change listening progress and bookmarks on the API key's own user.

For poking at one tool by hand, the inspector against the same stack — mint a
key at Settings → Users → API Keys:

```sh
docker compose -f test/integration/compose.yml up -d
AUDIOBOOKSHELF_URL=http://127.0.0.1:13378 AUDIOBOOKSHELF_API_KEY=… \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## The tool reference is generated

`docs/reference/tools.md` is produced from the tools the server actually registers.
After changing a tool name, description or parameter:

```sh
npm run build && npm run docs:tools
```

CI fails if the committed file is stale. The curated summary table in `README.md` is
hand-written and needs updating separately.

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs lint, build and tests on Node 22 and 24, coverage with thresholds, an npm
  audit, CodeQL, and a Trivy scan of the image on amd64 and arm64.
- **Comments** explain constraints the code cannot show — not what the next line does.
  Much of this codebase exists because the Audiobookshelf API is surprising in
  specific places; those surprises belong in comments.
- **Security-sensitive areas** (config parsing, confirmation tokens, anything that
  builds a request URL or forwards a request body): please describe the attack you are
  defending against, or the one your change might open, in the PR text.
- **Response size is a feature.** Audiobookshelf returns very large objects. A new
  tool that returns media needs a compact projection and a `detail: "full"` escape
  hatch, and a list tool needs a cap and a note saying how to page on.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/audiobookshelf-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/audiobookshelf-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/audiobookshelf-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
