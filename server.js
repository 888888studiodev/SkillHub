const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./store');
const apiOrigin = process.env.SKILLHUB_API_ORIGIN ? new URL(process.env.SKILLHUB_API_ORIGIN) : null;
if (apiOrigin && (!['http:', 'https:'].includes(apiOrigin.protocol) || apiOrigin.username || apiOrigin.password)) {
  throw new Error('SKILLHUB_API_ORIGIN 必须是 HTTP 或 HTTPS 地址');
}
if (apiOrigin && !apiOrigin.pathname.endsWith('/')) apiOrigin.pathname += '/';

let store;
if (!apiOrigin) {
  const database = process.env.SKILLHUB_DB || path.join(__dirname, 'data', 'skillhub.sqlite');
  if (database !== ':memory:') fs.mkdirSync(path.dirname(database), { recursive: true });
  store = createStore(database);
}

function proxyApi(req, res, url, send) {
  const upstream = new URL(url.pathname.slice(1) + url.search, apiOrigin);
  const transport = upstream.protocol === 'https:' ? https : http;
  const headers = {};
  for (const name of ['content-type', 'content-length']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const request = transport.request(upstream, { method: req.method, headers }, response => {
    res.writeHead(response.statusCode, {
      'Content-Type': response.headers['content-type'] || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.on('error', error => res.destroy(error));
    response.pipe(res);
  });
  request.setTimeout(30000, () => request.destroy(new Error('云端请求超时')));
  request.on('error', () => {
    if (res.headersSent) res.destroy();
    else send(502, { error: '无法连接 SkillHub 云端服务' });
  });
  res.on('close', () => {
    if (!res.writableEnded) request.destroy();
  });
  req.pipe(request);
}
const javascript = 'text/javascript; charset=utf-8';
const css = 'text/css; charset=utf-8';
const files = new Map([
  ['/', [path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8']],
  ['/app.js', [path.join(__dirname, 'public', 'app.js'), javascript]],
  ['/editor.js', [path.join(__dirname, 'public', 'editor.js'), javascript]],
  ['/style.css', [path.join(__dirname, 'public', 'style.css'), css]],
  ['/quill.js', [require.resolve('quill/dist/quill.js'), javascript]],
  ['/quill.snow.css', [require.resolve('quill/dist/quill.snow.css'), css]]
]);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    if (apiOrigin && url.pathname.startsWith('/api/')) return proxyApi(req, res, url, send);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const match = url.pathname.match(/^\/([a-z0-9][a-z0-9-]{0,89})(\/?)$/);
      const slug = match && match[1] !== 'api' ? match[1] : null;
      if (slug && match[2]) {
        res.writeHead(308, { Location: `../${slug}${url.search}` });
        return res.end();
      }
      const asset = files.get(url.pathname) || (slug && files.get('/'));
      if (asset) {
        const [file, type] = asset;
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
      }
    }
    let body = {};
    if (['POST', 'PATCH'].includes(req.method)) {
      const limit = /^\/api\/posts(?:\/\d+)?$/.test(url.pathname) ? 9_100_000 : 50_000;
      let bytes = 0;
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes <= limit) raw += chunk;
      }
      if (bytes > limit) return send(413, { error: '请求内容过长' });
      body = JSON.parse(raw || '{}');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return send(404, { error: '未找到' });
    if (parts[1] === 'categories') {
      if (req.method === 'GET' && !parts[2]) return send(200, store.categories());
      if (req.method === 'POST' && !parts[2]) return send(201, store.createCategory(body.name, body.parentId));
      if (req.method === 'PATCH' && parts[2] && parts[3] === 'position' && !parts[4]) {
        return send(200, store.moveCategory(Number(parts[2]), body));
      }
      if (req.method === 'PATCH' && parts[2] && !parts[3]) { store.renameCategory(Number(parts[2]), body.name); return send(200, { ok: true }); }
      if (req.method === 'DELETE' && parts[2]) { store.deleteCategory(Number(parts[2])); return send(200, { ok: true }); }
    }
    if (parts[1] === 'posts') {
      if (req.method === 'GET' && !parts[2]) return send(200, store.posts());
      if (req.method === 'POST' && !parts[2]) {
        const { id } = store.createPost(body);
        return send(201, body.document === undefined ? { id } : store.getPost(id));
      }
      if (req.method === 'PATCH' && parts[2] && !parts[3]) {
        if (!store.updatePostDocument(Number(parts[2]), body.document, body)) return send(404, { error: '帖子不存在' });
        return send(200, store.getPost(Number(parts[2])));
      }
      if (req.method === 'DELETE' && parts[2] && !parts[3]) {
        const id = Number(parts[2]);
        if (!Number.isSafeInteger(id) || id < 1) return send(400, { error: '帖子编号无效' });
        store.deletePost(id);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && parts[2] && !parts[3]) { const post = store.getPost(Number(parts[2])); return send(post ? 200 : 404, post || { error: '帖子不存在' }); }
      if (req.method === 'POST' && parts[2] && parts[3] === 'comments') return send(201, store.createComment(Number(parts[2]), body.author, body.content));
    }
    send(404, { error: '未找到' });
  } catch (error) { send(400, { error: error.message.includes('FOREIGN KEY') ? '所选方向或帖子不存在' : error.message }); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`SkillHub running on port ${process.env.PORT || 3000}`));
