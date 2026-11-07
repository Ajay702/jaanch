#!/usr/bin/env node
import { main } from '../src/cli.js';

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(`\n\x1b[31mJaanch failed:\x1b[0m ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
);
