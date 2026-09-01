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

Six operations that take something out — the three deletes, `delete_bookmark`,
`remove_books_from_collection` and `remove_items_from_playlist` — **ask a person**
through MCP elicitation. That is a dialog raised by the server and shown by the
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
