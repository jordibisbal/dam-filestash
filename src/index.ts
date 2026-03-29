import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const FILESTASH_ORIGIN = new URL(process.env.FILESTASH_URL ?? 'http://filestash:8334');
const DASHBOARD_ORIGIN = new URL(process.env.DASHBOARD_URL ?? 'http://dashboard:3000');
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const FILESTASH_PORT = parseInt(FILESTASH_ORIGIN.port || '8334', 10);

// Injected into every HTML page served by Filestash to add the CAPTION button.
const pluginScript = fs.readFileSync(path.join(__dirname, '..', 'caption-plugin.js'), 'utf8');
const SCRIPT_INJECTION = `<script>${pluginScript}</script>`;

// Proxy a request to Filestash, stripping security headers that prevent iframe
// embedding, and injecting the caption plugin into HTML responses.
function proxyToFilestash(req: http.IncomingMessage, res: http.ServerResponse): void {
  const options: http.RequestOptions = {
    hostname: FILESTASH_ORIGIN.hostname,
    port: FILESTASH_PORT,
    path: req.url ?? '/',
    method: req.method,
    headers: {
      ...req.headers,
      host: FILESTASH_ORIGIN.host,
      // Prevent gzip so we can inject into the raw HTML body.
      'accept-encoding': 'identity',
    },
  };

  const proxy = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];

    const isHtml = (headers['content-type'] ?? '').includes('text/html');

    if (isHtml) {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        html = html.includes('</body>')
          ? html.replace('</body>', `${SCRIPT_INJECTION}</body>`)
          : html + SCRIPT_INJECTION;
        headers['content-length'] = Buffer.byteLength(html).toString();
        delete headers['transfer-encoding'];
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        res.end(html);
      });
    } else {
      res.writeHead(proxyRes.statusCode ?? 200, headers);
      proxyRes.pipe(res, { end: true });
    }
  });

  proxy.on('error', () => { res.writeHead(502); res.end('Filestash unavailable'); });
  req.pipe(proxy, { end: true });
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  // GET /open — create a local-backend session then redirect to the file browser.
  if (url === '/open' && req.method === 'GET') {
    const body = JSON.stringify({ type: 'local', path: '/srv/' });
    const bodyBuf = Buffer.from(body);
    const sessionReq = http.request(
      {
        hostname: FILESTASH_ORIGIN.hostname,
        port: FILESTASH_PORT,
        path: '/api/session',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': bodyBuf.length,
          host: FILESTASH_ORIGIN.host,
        },
      },
      (sessionRes) => {
        const setCookie = sessionRes.headers['set-cookie'];
        const redirectHeaders: http.OutgoingHttpHeaders = { location: '/' };
        if (setCookie) redirectHeaders['set-cookie'] = setCookie;
        res.writeHead(302, redirectHeaders);
        res.end();
      },
    );
    sessionReq.on('error', () => { res.writeHead(302, { location: '/' }); res.end(); });
    sessionReq.write(bodyBuf);
    sessionReq.end();
    return;
  }

  // POST /api/caption — map Filestash paths to captioner paths and forward to
  // the dashboard, which publishes the job to Kafka.
  if (url === '/api/caption' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let payload: { job_id?: string; image_path?: string } = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* ignore */ }

      // data-path in Filestash is /images/... → captioner sees /app/images/...
      // (the plugin already prepends /app, so forward as-is)
      const imagePath = payload.image_path ?? '';
      const body = JSON.stringify({ job_id: payload.job_id, image_path: imagePath });
      const bodyBuf = Buffer.from(body);

      const fwdReq = http.request(
        {
          hostname: DASHBOARD_ORIGIN.hostname,
          port: parseInt(DASHBOARD_ORIGIN.port || '3000', 10),
          path: '/api/caption',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': bodyBuf.length },
        },
        (fwdRes) => {
          res.writeHead(fwdRes.statusCode ?? 200, { 'content-type': 'application/json' });
          fwdRes.pipe(res, { end: true });
        },
      );
      fwdReq.on('error', () => { res.writeHead(500); res.end('{"error":"caption request failed"}'); });
      fwdReq.write(bodyBuf);
      fwdReq.end();
    });
    return;
  }

  // Everything else — transparent proxy to Filestash with plugin injection.
  proxyToFilestash(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[filestash-proxy] http://0.0.0.0:${PORT} → ${FILESTASH_ORIGIN.href}`);
});
