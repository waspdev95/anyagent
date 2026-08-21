/**
 * Public API.
 *
 * anyagent is a CLI first, but the pieces are exported so that other tools can
 * reuse the catalog, the compatibility rules and the agent integrations.
 */

export * from './types.js';
export * from './catalog.js';
export * from './resolve.js';
export * from './agents/index.js';
export { createCli, type Cli } from './context.js';
export { main, reportError } from './app.js';
export { VERSION } from './version.js';
