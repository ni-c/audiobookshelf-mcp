#!/usr/bin/env node
/**
 * Drives the three beats of the demo GIF (see demo.tape). Run from the repo root:
 *
 *   AUDIOBOOKSHELF_URL=… AUDIOBOOKSHELF_API_KEY=… node docs/demo.mjs
 *
 * Talks to the built server over stdio exactly as a client would. It only ever
 * READS, plus one first-call-of-a-destructive-tool that returns a confirmation
 * token and deletes nothing — so it is safe to point at any instance. Requires
 * `npm run build` and at least one collection to exist for the third beat.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEAT = Number(process.env.DEMO_BEAT_MS ?? 1400);

function out(s = '') {
  process.stdout.write(s + '\n');
}

/**
 * Text of a tool result. Results carrying upstream content are prefixed with the
 * untrusted-data marker, so JSON payloads start at the first brace rather than at
 * character zero.
 */
function textOf(result) {
  const raw = (result.content ?? []).map((c) => c.text ?? '').join('\n');
  const start = raw.search(/[[{]/);
  return start === -1 ? raw : raw.slice(start);
}

const client = new Client({ name: 'demo', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      PATH: process.env.PATH,
      AUDIOBOOKSHELF_URL: process.env.AUDIOBOOKSHELF_URL,
      AUDIOBOOKSHELF_API_KEY: process.env.AUDIOBOOKSHELF_API_KEY,
    },
    stderr: 'ignore',
  })
);

// ---------------------------------------------------------------- beat 1
const { tools } = await client.listTools();
const read = tools.filter((t) => t.annotations?.readOnlyHint).length;
out(`$ tools/list`);
out(`  ${tools.length} tools — ${read} read, ${tools.length - read} write`);
await sleep(BEAT);

// ---------------------------------------------------------------- beat 2
out('');
out('$ list_library_items  (compact projection, the default)');
const libs = JSON.parse(
  textOf(await client.callTool({ name: 'list_libraries', arguments: {} }))
).libraries;
const lib = libs.find((l) => l.mediaType === 'book') ?? libs[0];
const page = JSON.parse(
  textOf(
    await client.callTool({
      name: 'list_library_items',
      arguments: { library_id: lib.id, limit: 3 },
    })
  )
);
/** Seconds below a minute, hours above one — "0 min" reads like a bug. */
function duration(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return ` · ${Math.round(seconds)} s`;
  if (seconds < 3600) return ` · ${Math.round(seconds / 60)} min`;
  return ` · ${(seconds / 3600).toFixed(1)} h`;
}

for (const item of page.results ?? []) {
  const authors = (item.authors ?? []).join(', ');
  out(`  ${item.title}${authors ? ` — ${authors}` : ''}${duration(item.durationSeconds)}`);
}
out(`  (${page.total} in "${lib.name}" — an expanded item can exceed 40 kB)`);
await sleep(BEAT);

// ---------------------------------------------------------------- beat 3
out('');
out('$ delete_collection  (first call — nothing is deleted)');
const collections = JSON.parse(
  textOf(await client.callTool({ name: 'list_collections', arguments: {} }))
).collections;
if (collections?.length) {
  const answer = textOf(
    await client.callTool({
      name: 'delete_collection',
      arguments: { collection_id: collections[0].id },
    })
  );
  for (const line of answer.split('\n')) out(`  ${line}`);
} else {
  out('  (no collection on this instance to demonstrate with)');
}
await sleep(BEAT);

await client.close();
