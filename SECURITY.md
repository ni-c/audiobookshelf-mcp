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
key.

The resource key covers every argument the dialog names. Where a tool writes
several things at once — `update_collection` and `update_playlist` can reorder a
list and rename the thing in the same call — the name and the description are
part of the key too, so an approval given for one name cannot be redeemed with
another. Approvals over sets of ids (the removals, the deletions) are keyed as
sets, where order is not part of the meaning; approvals whose meaning is an
order are keyed by position.

**Replay.** A seal proves that an answer belongs to the question it was given,
and not that it is recent. `serveStdio` negotiates protocol revision
`2026-07-28`, where the sealed `requestState` travels out through the client and
comes back with the answer — so a state that opens onto an operation would open
onto it again for as long as it lives. `mcp-approval` 0.8.1 and later put a
nonce in the state and spend it on the first answer, accepted or declined, which
closes that. Two limits worth stating plainly: the record of spent states is
per process, so a restart forgets it, and the sealing key is 32 random bytes per
process, so a state sealed in one session cannot be opened in the next anyway.
The `confirm_token` path is single-use and expires after five minutes.

**What a removal can reach.** Audiobookshelf deletes a playlist outright once
its last entry is removed, so `remove_items_from_playlist` can delete one.
It reads the playlist before it asks, says so in the dialog when the removal
takes the last entry, and refuses outright on a server started without
`delete_playlist` — an operator who takes the delete tool away does not get the
deletion back under another name.

## What is removed from an answer

Everything the API returns passes through one cleaner on its way out:

- **Control characters** (C0 and C1 except tab, newline and carriage return, and
  DEL) are stripped from every string and every key, in both the text block and
  `structuredContent`. An escape sequence in a book title is a way to draw on
  the terminal of whoever reads the tool result. Bidirectional marks and joiners
  are kept — they are content in a title written in Arabic or Hebrew.
- **Credentials in URLs.** A private podcast feed is published as
  `https://user:token@host/feed.rss`, Audiobookshelf stores it as given, and
  `get_library_item` hands it back. The userinfo is replaced.
- **Credential fields.** `GET /api/me` answers with the account's old
  non-expiring access token in a `token` field — for the root account included,
  because the server calls its own serializer without `hideRootToken`. Any field
  whose name ends in `token`, `password`, `secret`, `apikey`, `passphrase`,
  `pash` or `privatekey` is replaced before the answer leaves, at any depth, and
  the result names the fields that were removed rather than dropping them
  silently.

The API key itself is checked for shape at startup and again before every
request: a value with a line break in it — a credential pasted across two lines
— is refused here rather than by the HTTP layer, whose own error message quotes
the value it refused.
