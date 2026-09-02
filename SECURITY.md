# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/audiobookshelf-mcp/security/advisories/new).
Do not open a public issue for an unpatched vulnerability, and do not include real
credentials, tokens, hostnames or private configuration in a report.

You can expect an initial response within a week. Fixed vulnerabilities are published
as a new release with a note in the CHANGELOG.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

The credential this server holds is an Audiobookshelf **API key**, and it acts on
behalf of exactly one Audiobookshelf user, inheriting that user's permissions. An
attacker who obtains it can do everything that user can do through the
Audiobookshelf API — not merely what this server exposes. For a key issued to an
admin account that includes reading every library, every user's data and the server
settings. Issue the key for the most restricted account that still does what you
need, and revoke it under **Settings → Users → API Keys** if it leaks.

What the key exposes through this server specifically: your library contents, what
you have listened to and when, your listening statistics and sessions, your
bookmarks, collections and playlists — and, unless `AUDIOBOOKSHELF_READ_ONLY=true`,
the ability to change all of the latter.

Treat every environment variable this server reads as a secret. The MCP client
process, and therefore the model driving it, sees every tool result — do not point
this server at a system whose data you would not put in a model's context.

Eight operations that can take something out — the three deletes,
`delete_bookmark`, `remove_books_from_collection`, `remove_items_from_playlist`,
and `update_collection` / `update_playlist` when they are given a replacement
membership — **ask a person** through MCP elicitation. That is a dialog raised by the server and shown by the
client, which the model cannot answer on its behalf; nothing happens until an
answer comes back, and the approval is bound to the exact targets.

Where the client cannot show a dialog, they fall back to a server-generated token
bound the same way. That fallback is weaker and this server says so rather than
implying somebody approved: it proves the call was made twice with the same
arguments, and nothing more. `ELICITATION=false` moves a capable client onto it
deliberately, for deployments where a dialog is the wrong shape — it does not remove
the guard, and the server prints one line at startup saying it is off.

Data returned from the upstream API is untrusted input — book descriptions come from
metadata providers and podcast summaries from RSS feeds, both written by third
parties. It is marked as such in every result, and confirmation prompts never quote
it.

## What this server deliberately cannot do

No user management, no server settings, no backups, no cache purging, no filesystem
browsing, no library or item deletion, no metadata rewriting, no file uploads — even
when the API key would permit them.

## What the confirmation proves

Both confirmation paths bind an answer to **one operation with one set of
arguments**: the two-call `confirm_token` through a one-use entry in the store,
the elicitation reply through a sealed (HMAC) `requestState` carrying the resource
key. Neither proves that the answer is _recent_. A sealed state that opens onto an
operation opens onto it whenever it is replayed.

No replay defence is built, because in this deployment shape there is nothing to
replay:

- The sealing key is 32 random bytes per process, and this is a stdio server
  spawned per session, so a state sealed in one session cannot be opened in the
  next.
- `requestState` only crosses the wire on protocol revision `2026-07-28`. This
  server does not set `supportedProtocolVersions`, so it takes the SDK's default
  list, which ends at `2025-11-25`; on that revision the SDK bridges the
  elicitation server-side and the value never leaves the process.
- The `confirm_token` path is single-use and expires after five minutes.

If any of those changes — a negotiated `2026-07-28`, or two processes serving the
two halves of one flow with a shared key — a nonce becomes necessary. The
approvals worth stealing here are `delete_collection`, `delete_playlist` and
`delete_media_progress`.
