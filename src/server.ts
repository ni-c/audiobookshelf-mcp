import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

import { ALL_TOOLS, ESSENTIAL_TOOLS, READ_TOOLS } from './tools/catalogue.js';
import {
  registerCollectionReadTools,
  registerCollectionWriteTools,
} from './tools/collections.js';
import {
  registerPlaylistReadTools,
  registerPlaylistWriteTools,
} from './tools/playlists.js';
import {
  registerBookmarkWriteTools,
  registerProgressWriteTools,
} from './tools/progress.js';

import { AudiobookshelfApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore, createApproval } from 'mcp-approval';
import { registerItemReadTools } from './tools/items.js';
import { registerLibraryReadTools } from './tools/libraries.js';
import { registerMeReadTools } from './tools/me.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  // Before anything is built: an unusable tool list should fail on the
  // way in, not leave a server running with tools quietly missing.
  const filter = buildToolFilter({
    allowTools: config.allowTools,
    denyTools: config.denyTools,
    catalogue: {
      all: ALL_TOOLS,
      essential: ESSENTIAL_TOOLS,
      ungated: READ_TOOLS,
    },
    names: {
      allow: 'AUDIOBOOKSHELF_ALLOW_TOOLS',
      deny: 'AUDIOBOOKSHELF_DENY_TOOLS',
      server: 'audiobookshelf-mcp',
    },
    gate: {
      closed: config.readOnly,
      variable: 'AUDIOBOOKSHELF_READ_ONLY',
      noun: 'read-only mode',
    },
  });

  const api = new AudiobookshelfApi(config);
  const confirmations = new ConfirmationStore();
  // One approver per server: it holds the key that seals the request state
  // carried out through the client and back.
  const approval = createApproval({
    server: 'audiobookshelf-mcp',
    elicitation: config.elicitation,
  });

  const server = new McpServer({
    name: 'audiobookshelf-mcp',
    version: packageVersion(),
  });

  // Wraps server.registerTool, so it has to sit before the first
  // register call and does not care how they are organised.
  installToolFilter(server, filter);

  registerLibraryReadTools(server, api);
  registerItemReadTools(server, api);
  registerMeReadTools(server, api);
  registerCollectionReadTools(server, api);
  registerPlaylistReadTools(server, api);

  // Read-only mode does not register the write tools at all. Rejecting them at
  // call time would still advertise capabilities the server refuses to provide.
  if (!config.readOnly) {
    registerProgressWriteTools(server, api, confirmations, approval);
    registerBookmarkWriteTools(server, api, confirmations, approval);
    registerCollectionWriteTools(server, api, confirmations, approval);
    registerPlaylistWriteTools(server, api, confirmations, approval);
  }

  return server;
}
