const http = require('node:http');
const { PNG } = require('pngjs');

const PORT = 6100;
const DEBUG = process.env.WEBREADER_DEBUG === '1';

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}
const FULLINFO = {
  id: 'comic-1',
  library_id: 'lib-1',
  title: 'Mock Comic',
  file_name: 'mock-comic.cbz',
  hash: 'mock-hash',
  num_pages: 3,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePng(color) {
  const png = new PNG({ width: 24, height: 32 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

const pageBuffers = [
  makePng([210, 90, 90]),
  makePng([90, 210, 120]),
  makePng([90, 120, 210]),
];

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing URL');
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/v2/library/lib-1/comic/comic-1/fullinfo') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(FULLINFO));
    return;
  }

  if (url.pathname === '/v2/library/lib-1/comic/comic-1/remote') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const pageMatch = url.pathname.match(/^\/v2\/library\/lib-1\/comic\/comic-1\/page\/(\d+)\/remote$/);
  if (pageMatch) {
    const pageIndex = Number.parseInt(pageMatch[1], 10);
    const body = pageBuffers[pageIndex];
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Page not found');
      return;
    }

    await sleep(900);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  debugLog(`Mock YACReader server listening on ${PORT}`);
});
