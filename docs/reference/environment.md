# Environment variables

The complete set. There is no config file and no command-line flag.

## `AUDIOBOOKSHELF_URL`

**Required.** Base URL of the Audiobookshelf instance, e.g.
`https://abs.example.com`.

| Rule                             | Behaviour                             |
| -------------------------------- | ------------------------------------- |
| Unparseable by `new URL()`       | Server exits with an error            |
| Scheme other than `http`/`https` | Server exits with an error            |
| Contains `user:pass@`            | Server exits with an error            |
| Trailing slashes                 | Stripped                              |
| Plain `http` to a remote host    | Warning on stderr, server continues   |
| Plain `http` to loopback         | No warning                            |

Loopback means `localhost`, `*.localhost`, `127.*` or `::1`.

## `AUDIOBOOKSHELF_API_KEY`

**Required.** Sent as `Authorization: Bearer <key>`. Created under
**Settings → Users → API Keys** (admin only, Audiobookshelf 2.26.0 or newer) and
shown once at creation.

Deleted from `process.env` after the configuration is read, so it is not visible to
child processes or in `/proc/<pid>/environ`.

Missing credentials are not fatal: the server starts, completes the handshake and
lists all 44 tools, and every call then fails with the setup instructions.

## `AUDIOBOOKSHELF_READ_ONLY`

**Optional**, default `false`. Exactly the string `true` enables it — `1`, `yes` and
`TRUE` do not, and the difference fails open, with the write tools registered. The
server logs the active setting at startup.

When enabled, the 15 write tools are never registered; `tools/list` returns 29.

## `AUDIOBOOKSHELF_INSECURE_TLS`

**Optional**, default `false`. Exactly the string `true` enables it.

Accepts self-signed and untrusted certificates **for the Audiobookshelf connection
only**, via a scoped undici dispatcher. It does not set
`NODE_TLS_REJECT_UNAUTHORIZED` and does not affect any other request the process
makes. A warning is printed to stderr while it is active.

Prefer adding your CA to the system trust store.

## Not configurable

| Behaviour         | Value          |
| ----------------- | -------------- |
| Request timeout   | 15 s           |
| HTTP redirects    | never followed |
| List cap          | 100 entries    |
| Description cap   | 800 characters |
| Error body cap    | 2000 chars     |
| Confirm-token TTL | 5 minutes      |
| Pending tokens    | max 100        |
