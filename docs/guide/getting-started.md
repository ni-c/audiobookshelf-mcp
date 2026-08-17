# Getting started

## Requirements

- **Node.js 22 or newer** (or Docker)
- **Audiobookshelf 2.26.0 or newer** — earlier versions have no API keys
- An Audiobookshelf **API key**

Check your server version without logging in:

```sh
curl -s https://abs.example.com/status | jq .serverVersion
```

## Getting an API key

API keys are managed by an admin under **Settings → Users → API Keys**.

A key acts on behalf of exactly one Audiobookshelf user and inherits that user's
permissions. A key issued for a normal account cannot see libraries that account
cannot see, and cannot delete anything unless that account may delete. That makes
the choice of user the main security control you have here — see
[Security](/guide/security).

::: warning The key is shown only once
Copy it at creation time. If you lose it, delete the key and create a new one.
:::

## Install

Nothing to install permanently — `npx` fetches the package on first run:

```sh
claude mcp add audiobookshelf \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  -- npx -y audiobookshelf-mcp
```

For every other client, see [Connecting clients](/guide/clients).

## First call

Ask your assistant something that needs the library:

> What am I in the middle of?

It should call `get_personalized_shelves` or `list_items_in_progress` and come back
with titles and positions. A good second question, because it exercises the
paging and projection logic:

> How many audiobooks do I own, and which is the longest?

That is `list_libraries` followed by `get_library_stats`.

## Check it by hand

If you would rather see the protocol, the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) lists the tools
and lets you call them one at a time:

```sh
AUDIOBOOKSHELF_URL=https://abs.example.com \
AUDIOBOOKSHELF_API_KEY=… \
  npx @modelcontextprotocol/inspector npx -y audiobookshelf-mcp
```

`get_server_status` is the cheapest connectivity test — it needs no ids and tells
you the server version.

## It starts even when it is misconfigured

Run it with no configuration at all and it still completes the MCP handshake and
lists all 44 tools; every call then fails with the setup instructions. That is
deliberate, so registry sandboxes and inspectors can enumerate the tools without
credentials. It also means "the tools are listed" is **not** proof that the
connection works — call `get_server_status` for that.

## Start read-only

If you only want the questions answered and nothing changed:

```sh
claude mcp add audiobookshelf \
  -e AUDIOBOOKSHELF_URL=https://abs.example.com \
  -e AUDIOBOOKSHELF_API_KEY=… \
  -e AUDIOBOOKSHELF_READ_ONLY=true \
  -- npx -y audiobookshelf-mcp
```

The 15 write tools are then not registered at all, so there is nothing to refuse
and nothing to talk into misbehaving.

## Next

- [Configuration](/guide/configuration) — every environment variable
- [FAQ & troubleshooting](/guide/faq) — when something returns 403 or nothing
