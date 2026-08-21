#!/usr/bin/env node
/**
 * Executable entry point.
 *
 * Nothing but wiring: the dispatcher lives in `app.ts` so the test suite can
 * call it directly instead of shelling out.
 */

import { main, reportError } from './app.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.exitCode = reportError(error);
  });
