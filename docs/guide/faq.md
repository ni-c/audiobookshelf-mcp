# FAQ & troubleshooting

## The tools are listed but every call fails

Expected when the configuration is incomplete: the server starts and handshakes
without credentials on purpose, so registries and inspectors can enumerate its
tools. The error text names the missing variables. Check your client is actually
passing them — `claude mcp list`, or the `env` block in the config file.

`get_server_status` is the cheapest real connectivity test.

## `401` or `403`

- **401** — the key is wrong, revoked, or not being passed.
- **403** — the key is valid but its user is not allowed. Remember the key acts as
  one Audiobookshelf user: a library that is not shared with that user returns 403,
  and deleting needs an account with delete permission. `get_me` shows you which
  user you are and what it may do.

## `404` on an id that exists

Either it does not exist, or it belongs to a library the key's user cannot access —
Audiobookshelf answers 404 in both cases, so the two are indistinguishable from
here. Compare against `list_libraries` output for the same key.

`get_media_progress` also returns 404 for an item that has simply never been
started. That is not an error condition, just an absence.

## API keys do not exist in my Audiobookshelf

They were added in **2.26.0**. Check with `curl -s https://abs.example.com/status`.
Older servers only have the browser login flow (short-lived access token plus
refresh rotation), which this server does not implement.

## A filter returns my whole library

That used to be the trap this server exists to prevent. Audiobookshelf expects the
`filter` parameter as `<group>.<base64(value)>` and treats an unknown group as a
*valueless* filter — so a typo silently returns the unfiltered library instead of an
error.

`list_library_items` therefore validates: pass `filter_group` and `filter_value`
separately, and a valued group without its value is rejected outright. Get the valid
values from `get_library_filter_data`.

```
filter_group="authors",  filter_value="<author id>"
filter_group="progress", filter_value="finished" | "in-progress" | "not-started" | "not-finished"
filter_group="issues"    (standalone, takes no value)
```

## A response was still too big

Ask for the compact form — that is the default, so check you are not passing
`detail: "full"`. If a compact projection is genuinely too large for your case,
that is worth an
[issue](https://github.com/ni-c/audiobookshelf-mcp/issues): the projections were
tuned against a real library and can be tuned further.

For lists, lower `limit` (max 100) and page with `page`. List tools tell you the
total and what to call next when more matches exist.

## Chapters are missing from `get_library_item`

By design — a long audiobook can have hundreds. Use `get_item_chapters`, or
`detail: "full"` for everything including audio files and tracks.

## `get_item_chapters` says my item is a podcast

Podcast episodes do not have chapters in Audiobookshelf. Use `get_podcast_episode`.

## My playlist disappeared

Audiobookshelf deletes a playlist automatically when its last entry is removed.
`remove_items_from_playlist` reports this in its result when it happens. It cannot
be restored — recreate it with `create_playlist`.

## Collections vs. playlists

- **Collections** are shared server-wide, hold books only, and need at least one
  book (Audiobookshelf rejects an empty one).
- **Playlists** are private per user, may be empty, and can hold podcast episodes.
  A playlist is homogeneous: either every entry has an `episode_id` or none does.

## Self-signed certificate

Add your CA to the system trust store if you can. Otherwise
`AUDIOBOOKSHELF_INSECURE_TLS=true`, which scopes the relaxed validation to this
connection only — see [Configuration](/guide/configuration).

## Can it play, pause or seek?

No. Playback is a session state machine that belongs in a real client.
`set_media_progress` moves your position, which covers "mark this finished" and
"jump me to chapter 12"; your phone does the playing.

## Can it add podcasts, scan the library or edit metadata?

No, deliberately — see [Security](/guide/security) for the full list of what is
left out and why.

## Which tools change something?

15 of the 44. In a client that shows MCP annotations, the read tools carry
`readOnlyHint` and the six that remove something carry `destructiveHint`. The
[tools reference](/reference/tools) labels every one, and
`AUDIOBOOKSHELF_READ_ONLY=true` removes all writes.

## Where do I report a problem?

- Questions and ideas →
  [Discussions](https://github.com/ni-c/audiobookshelf-mcp/discussions)
- Reproducible problems →
  [Issues](https://github.com/ni-c/audiobookshelf-mcp/issues)
- Vulnerabilities →
  [private reporting](https://github.com/ni-c/audiobookshelf-mcp/security/advisories/new)
