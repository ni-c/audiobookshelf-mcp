import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AudiobookshelfApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore } from './confirm.js';
import {
  registerCollectionReadTools,
  registerCollectionWriteTools,
} from './tools/collections.js';
import { registerItemReadTools } from './tools/items.js';
import { registerLibraryReadTools } from './tools/libraries.js';
import { registerMeReadTools } from './tools/me.js';
import {
  registerPlaylistReadTools,
  registerPlaylistWriteTools,
} from './tools/playlists.js';
import {
  registerBookmarkWriteTools,
  registerProgressWriteTools,
} from './tools/progress.js';

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
  const api = new AudiobookshelfApi(config);
  const confirmations = new ConfirmationStore();

  const server = new McpServer({
    name: 'audiobookshelf-mcp',
    version: packageVersion(),
  });

  registerLibraryReadTools(server, api);
  registerItemReadTools(server, api);
  registerMeReadTools(server, api);
  registerCollectionReadTools(server, api);
  registerPlaylistReadTools(server, api);

  // Read-only mode does not register the write tools at all. Rejecting them at
  // call time would still advertise capabilities the server refuses to provide.
  if (!config.readOnly) {
    registerProgressWriteTools(server, api, confirmations);
    registerBookmarkWriteTools(server, api);
    registerCollectionWriteTools(server, api, confirmations);
    registerPlaylistWriteTools(server, api, confirmations);
  }

  return server;
}
