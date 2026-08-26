# Configuration

Everything is configured through environment variables. There is no config file
and no command-line flag.

| Variable                      | Required | Default | Description                                                   |
| ----------------------------- | -------- | ------- | ------------------------------------------------------------- |
| `AUDIOBOOKSHELF_URL`          | yes      | —       | Base URL of the instance, e.g. `https://abs.example.com`      |
| `AUDIOBOOKSHELF_API_KEY`      | yes      | —       | API key, sent as `Authorization: Bearer …`                    |
| `AUDIOBOOKSHELF_READ_ONLY`    | no       | `false` | `true` registers only the 29 read tools                       |
| `AUDIOBOOKSHELF_INSECURE_TLS` | no       | `false` | `true` accepts self-signed certificates for this connection   |

Only the exact string `true` enables the two booleans. `1`, `yes` and `TRUE` do
not — which is worth knowing, because a typo in `AUDIOBOOKSHELF_READ_ONLY` fails
*open*, with the write tools registered. The server logs which switches are active
at startup; check that line rather than trusting the spelling.

See the [environment reference](/reference/environment) for the same table with
the validation rules.

## `AUDIOBOOKSHELF_URL`

Validated at startup with `new URL()`. The server **exits** if it is:

- unparseable,
- not `http://` or `https://`,
- or carries credentials in the form `https://user:pass@host` — those would end up
  in logs and error messages, and the API key is the supported mechanism.

Trailing slashes are stripped, so `https://abs.example.com/` and
`https://abs.example.com` behave identically.

Plain `http://` to a **non-loopback** host produces a warning and keeps going: the
API key would cross the network unencrypted. `http://localhost` and `http://127.*`
do not warn.

::: tip Reverse proxies and subpaths
Point the URL at whatever serves the Audiobookshelf UI. If it lives under a
subpath, include it — `https://media.example.com/audiobookshelf`. The server
appends `/api/…` to exactly what you give it.
:::

## `AUDIOBOOKSHELF_API_KEY`

Created under **Settings → Users → API Keys** by an admin, shown once.

The key is **deleted from `process.env` once the configuration has been read**, so
it is not visible to child processes or in `/proc/<pid>/environ` for the lifetime
of the process.

Credentials are only required when a tool actually calls the API — not at startup.
The server starts, handshakes and lists its tools without them, and every call then
fails with the setup instructions. That is what lets a registry sandbox enumerate
the tools.

## `AUDIOBOOKSHELF_READ_ONLY`

`true` means the 15 write tools are **never registered** — not registered and then
refused. A client asking for `tools/list` sees 29 tools, and there is no capability
advertised that the server would decline to provide.

Use it when you want the library answerable but not editable, which is most of the
time.

## `AUDIOBOOKSHELF_INSECURE_TLS`

For an instance behind a self-signed or internal-CA certificate.

This does **not** set `NODE_TLS_REJECT_UNAUTHORIZED`. It creates a scoped
[undici](https://undici.nodejs.org/) dispatcher used only for requests to your
Audiobookshelf, so nothing else the process does is affected. The server prints a
warning to stderr while it is on.

Prefer adding your CA to the system trust store; this switch is the escape hatch,
not the recommendation.

## Fixed behaviour

Not configurable, deliberately:

| Behaviour           | Value          | Why                                                                    |
| ------------------- | -------------- | ---------------------------------------------------------------------- |
| Request timeout     | 15 s           | A hung request would hang the tool call                                |
| Redirects           | never followed | A redirect would replay the `Authorization` header at another host     |
| List cap            | 100 entries    | One call must not be able to flood the context                         |
| Description cap     | 800 characters | Metadata-provider descriptions run to many kB                          |
| Error body cap      | 2000 chars     | HTML error pages are dropped entirely, other bodies truncated          |
| Confirm-token TTL   | 5 minutes      | Long enough for a round trip, short enough not to linger               |

## Choosing the tools that load

Read-only mode is one cut, along a line this server drew for you.
`AUDIOBOOKSHELF_ALLOW_TOOLS` and `AUDIOBOOKSHELF_DENY_TOOLS` let you draw your own:

```sh
AUDIOBOOKSHELF_ALLOW_TOOLS=essential
AUDIOBOOKSHELF_ALLOW_TOOLS=search_library,get_library_item,set_media_progress
AUDIOBOOKSHELF_DENY_TOOLS=delete_*
```

Why bother, when all forty-four work: a model chooses the right tool far more
reliably from a handful than from a long list, and every tool it can see costs
context on every single request. If this is the only MCP server in a session,
forty-four is fine. If it is one of six, it is not.

**The syntax.** Comma-separated entries. An entry is either an exact tool name or
a prefix with a trailing `*` — `list_*` matches every tool whose name starts with
`list_`. Entries are trimmed and case-insensitive, empty ones are ignored, and an
empty value counts as unset. Nothing else is a pattern: `*_x` and `list_*_x` are
rejected rather than silently matching nothing.

**`essential`** is a curated preset of eight:

`list_libraries`, `search_library`, `list_library_items`, `get_library_item`, `get_item_chapters`, `list_items_in_progress`, `get_media_progress`, `set_media_progress`.

It composes — naming a tool alongside it puts that one back, and
`AUDIOBOOKSHELF_DENY_TOOLS` takes one away.

**Both together.** `AUDIOBOOKSHELF_ALLOW_TOOLS` decides what is in;
`AUDIOBOOKSHELF_DENY_TOOLS` is then subtracted from the result. With only a deny list,
everything else stays.

**A name that matches nothing stops the server**, with the offending entry and the
list of real names. That is deliberate: the alternative is a tool quietly missing
from `tools/list`, and nobody traces an absence back to an environment variable.
The same applies to a pattern that matches no tool.

**With read-only mode**, the write tools are not registered at all, so naming
one explicitly in `AUDIOBOOKSHELF_ALLOW_TOOLS` is an error that says so — rather than
calling a tool unknown when it plainly exists. A _pattern_ that covers write
tools is fine and simply contributes nothing, and
`AUDIOBOOKSHELF_ALLOW_TOOLS=essential` narrows to the read half of the preset.

::: tip It is the same cut, not a second one
A filtered tool is never registered, so it is absent from `tools/list` and
unknown to `tools/call` alike — exactly what `AUDIOBOOKSHELF_READ_ONLY` does to a
write tool. There is no "hidden but callable" state to reason about.
:::
