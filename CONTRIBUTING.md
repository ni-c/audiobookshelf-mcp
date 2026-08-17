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

A minimal dev environment — a throwaway Audiobookshelf you can safely write to:

```sh
docker run -d --name abs-dev -p 13378:80 \
  -v "$PWD/abs-dev/config:/config" -v "$PWD/abs-dev/metadata:/metadata" \
  -v "$PWD/abs-dev/audiobooks:/audiobooks" \
  ghcr.io/advplyr/audiobookshelf:latest
# Create the root user at http://localhost:13378, then
# Settings -> Users -> API Keys -> new key.

AUDIOBOOKSHELF_URL=http://localhost:13378 \
AUDIOBOOKSHELF_API_KEY=… \
  npx @modelcontextprotocol/inspector node dist/index.js
```

Please do not develop against an Audiobookshelf holding data you care about: the
write tools change listening progress and bookmarks on the API key's own user.

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
- Run `npm run lint` before pushing — it checks both eslint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/audiobookshelf-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/audiobookshelf-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/audiobookshelf-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
