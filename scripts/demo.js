// Starts the ChaiCart demo shop and points Jaanch at it.
//   npm run demo              (headless)
//   npm run demo -- --watch   (watch Brave click around)
import { createServer } from '../demo/server.js';
import { main } from '../src/cli.js';

const port = Number(process.env.PORT) || 4173;
const server = createServer().listen(port);
await new Promise((r) => server.once('listening', r));
let code = 1;
try {
  code = await main([`http://localhost:${port}`, ...process.argv.slice(2)]);
} finally {
  server.close();
}
process.exit(code);
