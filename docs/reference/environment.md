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

## `ELICITATION`

**Optional**, default `true`. Whether a client that *can* show a dialog is asked
before a guarded tool acts. `false` takes the two-call-token path instead — it
does not remove the guard, and a server started with it off prints one line
saying so.

Two ways it differs from every other variable on this page:

- **No prefix.** One `export ELICITATION=false` reaches every MCP server in the
  same environment, not just this one. That is the point of it and also its risk;
  see [Asking a person](/guide/approval).
- **Fatal on anything else.** `1`, `off` or a typo stop the server with exit code
  1 rather than falling back to the default. It is the only variable of this
  family that defaults to *on*, and a typo that fell back would leave the dialog
  running while you believed it was off.

Values are trimmed and matched case-insensitively, so `False` and ` false ` both
work — the strictness is about which words count, not about their shape. It is
read *after* the API key is deleted from `process.env`, so the fatal path cannot
leave the key sitting there for a crash reporter.

## Not configurable

| Behaviour         | Value          |
| ----------------- | -------------- |
| Request timeout   | 15 s           |
| HTTP redirects    | never followed |
| List cap          | 100 entries    |
| Description cap   | 800 characters |
| Error body cap    | 2000 chars     |
| Fallback token TTL | 5 minutes     |
| Pending tokens    | max 100        |

## Narrowing the tool list

| Variable | Required | Description |
| --- | --- | --- |
| `AUDIOBOOKSHELF_ALLOW_TOOLS` | no | Tool names, `list_*` prefixes or `essential`; only these register |
| `AUDIOBOOKSHELF_DENY_TOOLS` | no | Same syntax; subtracted from whatever the allow list left |

Both are comma-separated. Each entry is either an exact tool name or a prefix with
a single trailing `*`. Entries are trimmed and matched case-insensitively; empty
entries are ignored, and a value that is empty or only whitespace counts as unset —
`AUDIOBOOKSHELF_ALLOW_TOOLS=` in a compose file does not mean "allow nothing".
`essential` is recognised only in the allow list, and selects `list_libraries`, `search_library`, `list_library_items`, `get_library_item`, `get_item_chapters`, `list_items_in_progress`, `get_media_progress`, `set_media_progress`.

**An entry that matches no tool aborts startup**, naming the entry and listing the
valid names, as does a malformed pattern such as `*_x` or `list_*_x`. The
alternative — ignoring the entry — leaves a tool missing from `tools/list` with
nothing pointing at the cause. If both lists together remove everything, the server
refuses to start rather than offering an empty tool list.

Under `AUDIOBOOKSHELF_READ_ONLY`, an exact write-tool name in the allow list is an
error naming the read-only setting rather than "unknown tool"; a pattern covering
write tools is accepted and merely contributes nothing, with a warning on stderr.
Deny entries are exempt: denying an already-suppressed tool is how a defensive
list is written.
