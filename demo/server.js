// ChaiCart: a tiny demo shop with bugs planted on purpose, so you can watch Jaanch find them.
//   node demo/server.js   →  http://localhost:4173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'index.html', '/menu': 'menu.html', '/signup': 'signup.html', '/dashboard': 'dashboard.html' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // API
    if (url.pathname === '/api/signup' && req.method === 'POST') return send(res, 201, { ok: true });
    // BUG: orders endpoint crashes on the server.
    if (url.pathname === '/api/orders') return send(res, 500, { error: 'Cannot read properties of undefined (reading "map")' });
    if (url.pathname === '/api/menu') return send(res, 200, [{ id: 'chai', name: 'Masala Chai', price: 30 }, { id: 'coffee', name: 'Filter Coffee', price: 40 }]);
    // Pages and static files
    const file = PAGES[url.pathname] ?? url.pathname.slice(1);
    const full = path.join(dir, path.normalize(file));
    if (!full.startsWith(dir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return send(res, 404, '<!doctype html><title>Not found</title><h1>404 · Page not found</h1><a href="/">Home</a>', 'text/html; charset=utf-8');
    }
    send(res, 200, fs.readFileSync(full), TYPES[path.extname(full)] ?? 'application/octet-stream');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => console.log(`ChaiCart demo running at http://localhost:${PORT}`));
}
