# Connecting clients

Every snippet below runs the same stdio server. Replace `https://abs.example.com`
with your instance and `…` with the API key from **Settings → Users → API Keys**.

## Claude Code

```sh
claude mcp add audiobookshelf \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  -- npx -y audiobookshelf-mcp
```

Check it took:

```sh
claude mcp list
```

## Claude Desktop

`claude_desktop_config.json` — macOS
`~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`:

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

Restart Claude Desktop afterwards; it only reads the file at startup.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.audiobookshelf]
command = "npx"
args = ["-y", "audiobookshelf-mcp"]
env = { AUDIOBOOKSHELF_URL = "https://abs.example.com", AUDIOBOOKSHELF_API_KEY = "…" }
```

## MCP Inspector

```sh
AUDIOBOOKSHELF_URL=https://abs.example.com \
AUDIOBOOKSHELF_API_KEY=… \
  npx @modelcontextprotocol/inspector npx -y audiobookshelf-mcp
```

## Docker

The image is multi-arch (amd64 and arm64) and published with an SBOM and build
provenance:

```sh
docker run -i --rm \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  ghcr.io/ni-c/audiobookshelf-mcp
```

`-i` is not optional: the protocol runs over stdin and stdout. There is no port to
publish and no healthcheck, because the server does not listen for anything.

As an MCP server entry:

```json
{
  "mcpServers": {
    "audiobookshelf": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "AUDIOBOOKSHELF_URL",
        "-e",
        "AUDIOBOOKSHELF_API_KEY",
        "ghcr.io/ni-c/audiobookshelf-mcp"
      ],
      "env": {
        "AUDIOBOOKSHELF_URL": "https://abs.example.com",
        "AUDIOBOOKSHELF_API_KEY": "…"
      }
    }
  }
}
```

Passing `-e NAME` without a value forwards the variable from the client's
environment instead of putting the key on the `docker run` command line, where it
would show up in `docker inspect` and in the host's process list.

## Pinning a version

`npx -y audiobookshelf-mcp` follows the `latest` tag. To pin:

```sh
npx -y audiobookshelf-mcp@0.1.0
```

…or use the matching image tag, `ghcr.io/ni-c/audiobookshelf-mcp:0.1.0`.

## Running it from a checkout

For development, or to run an unreleased change:

```sh
git clone https://github.com/ni-c/audiobookshelf-mcp.git
cd audiobookshelf-mcp
npm install && npm run build

AUDIOBOOKSHELF_URL=https://abs.example.com \
AUDIOBOOKSHELF_API_KEY=… \
  node dist/index.js
```

See [CONTRIBUTING.md](https://github.com/ni-c/audiobookshelf-mcp/blob/main/CONTRIBUTING.md)
for a throwaway Audiobookshelf you can safely write to.
