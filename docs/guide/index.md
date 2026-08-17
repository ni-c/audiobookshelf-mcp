# What is audiobookshelf-mcp?

[Audiobookshelf](https://www.audiobookshelf.org/) is a self-hosted server for
audiobooks and podcasts. It knows what you own, what you have listened to, how far
you got and when — which is exactly the kind of thing you end up asking an
assistant about, and exactly the kind of thing an assistant cannot answer without
access to your library.

`audiobookshelf-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that gives one to it. It exposes 44 tools over the Audiobookshelf REST API:
29 that read and 15 that write.

## What you can do with it

- **Ask about your library.** "Do I own anything by Frank Schätzing?" "Which of my
  audiobooks are longer than 20 hours?" "What's in the Ozean series and do I have
  all of it?"
- **Ask about your listening.** "What am I in the middle of?" "How much did I listen
  to last month?" "Which book did I abandon furthest in?" "What did I finish in
  2025?"
- **Keep things tidy.** Mark a book finished, jump the position to a chapter, drop a
  bookmark at the good bit, build a collection or a playlist from the answers to
  the questions above.

## What it is not

It is not a player. There is no play, pause or seek: Audiobookshelf's playback
session API is a state machine that belongs in a real client, and a model driving
it would be a worse experience than the app you already have. `set_media_progress`
moves your position; your phone does the playing.

It also deliberately stops well short of what an admin API key could do — see
[Security](/guide/security).

## How it fits together

The server speaks **stdio** and never listens on a port. Your MCP client starts it
as a child process, it holds one Audiobookshelf API key, and it calls the REST API
over HTTPS. There is no daemon to run and nothing to expose.

## The response-size problem

This is the part worth knowing before you start, because it shaped most of the
design.

Audiobookshelf returns very large objects. A single expanded library item carries
every audio file, every track and every chapter with full ffprobe metadata — one
book easily exceeds 40 kB of JSON, and a page of 25 of them exceeds the useful
context of any model. `/api/me/listening-stats` was measured at 95 kB on a
three-year-old instance, because it embeds the totals of every calendar day since
the account existed plus the complete media metadata of everything ever played.

So every tool that returns media answers with a **compact projection** by default:
the fields that matter for browsing, ids and values matching Audiobookshelf's own
names, descriptions truncated, embedded blobs dropped. `detail: "full"` gets you
the raw object when you actually want it. List tools cap at 100 entries and tell
you how to page on.

The practical effect: `get_listening_stats` went from 95 kB to 3.5 kB, and
`list_series` from 5.3 kB to 0.6 kB, without losing anything you would ask about.

## Next

- [Getting started](/guide/getting-started) — API key, install, first call
- [Connecting clients](/guide/clients) — Claude Code, Claude Desktop, Codex, Docker
- [Tools reference](/reference/tools) — all 44, with every parameter
