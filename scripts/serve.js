const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const preferredPort = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function createServer(port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
    const relative = urlPath === '/' ? 'daily-checkin.html' : urlPath.slice(1);
    const file = path.resolve(root, relative);

    if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, mime[path.extname(file)] || 'application/octet-stream');
    });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && port < preferredPort + 20) createServer(port + 1);
    else throw err;
  });

  server.listen(port, () => {
    console.log(`Daily Check-in web preview: http://localhost:${port}`);
  });
}

createServer(preferredPort);
