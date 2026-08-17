#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_INSECURE_TLS=true — TLS certificate validation is disabled for the Audiobookshelf connection'
    );
  }
  if (config.readOnly) {
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_READ_ONLY=true — write tools are not registered'
    );
  }

  const server = createServer(config);
  // stdout belongs to the protocol; everything human-readable goes to stderr.
  await server.connect(new StdioServerTransport());
  console.error(
    config.url
      ? `audiobookshelf-mcp: connected, targeting ${config.url}`
      : 'audiobookshelf-mcp: connected without configuration — tools are listed but every call will fail'
  );
}

main().catch((error: unknown) => {
  console.error('audiobookshelf-mcp: fatal error:', error);
  process.exit(1);
});
