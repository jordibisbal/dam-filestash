import * as http from 'http';

const FILESTASH_ORIGIN = new URL(process.env.FILESTASH_URL ?? 'http://filestash:8334');
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const FILESTASH_PORT = parseInt(FILESTASH_ORIGIN.port || '8334', 10);

// Injected into every Filestash HTML page so the caption toolbar button is loaded.
const SCRIPT_TAG = '<script src="/api/plugin/caption/plugin.js"></script>';

// Injected CSS fixes (applied via a MutationObserver script so our <style> is
// always the last one in the CSSOM, winning any !important specificity ties):
// 1. Remove the max-width:815px cap on the content area when the sidebar is hidden/empty.
// 2. Hide .xmp sidecar files wherever they appear (case-insensitive).
const OVERRIDE_CSS =
  '.component_filemanager_shell [data-bind="sidebar"].hidden~div>[data-bind="filemanager-children"] .container,' +
  '.component_filemanager_shell [data-bind="sidebar"]:empty~div>[data-bind="filemanager-children"] .container,' +
  '.component_filemanager_shell [data-bind="sidebar"].hidden~div>component-breadcrumb>.component_breadcrumb,' +
  '.component_filemanager_shell [data-bind="sidebar"]:empty~div>component-breadcrumb>.component_breadcrumb' +
  '{max-width:none!important;width:100%!important}' +
  '[data-path$=".xmp" i]{display:none!important}';

const STYLE_TAG =
  '<script>(function(){' +
  'function applyOverride(){' +
  'var s=document.getElementById("__dam_override");' +
  'if(!s){s=document.createElement("style");s.id="__dam_override";document.head.appendChild(s);}' +
  's.textContent=' + JSON.stringify(OVERRIDE_CSS) + ';' +
  '}' +
  'applyOverride();' +
  'new MutationObserver(applyOverride).observe(document.head,{childList:true});' +
  '})()</script>';

// Strings to rewrite in JavaScript responses (sub_filter equivalent).
// Filestash's ctrlSidebar bails with `if (window.self !== window.top) return`
// when running inside an iframe — rewrite that check to false so the sidebar
// always renders.
const JS_REWRITES: Array<[string, string]> = [
  ['new URL(location.toString()).searchParams.get(\\"nav\\") === \\"false\\"', 'false'],
  ['window.self!==window.top', 'false'],
  ['window.self !== window.top', 'false'],
];

// Proxy a request to Filestash, stripping security headers that prevent iframe
// embedding and injecting the caption plugin script into HTML responses.
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

    const contentType = headers['content-type'] ?? '';
    const isHtml = contentType.includes('text/html');
    const isJs   = contentType.includes('javascript');

    if (isHtml || isJs) {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        if (isHtml) {
          const inject = STYLE_TAG + SCRIPT_TAG;
          body = body.includes('</body>')
            ? body.replace('</body>', `${inject}</body>`)
            : body + inject;
        }
        if (isJs) {
          for (const [from, to] of JS_REWRITES) {
            body = body.split(from).join(to);
          }
        }
        headers['content-length'] = Buffer.byteLength(body).toString();
        delete headers['transfer-encoding'];
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        res.end(body);
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

  // Everything else — transparent proxy to Filestash.
  proxyToFilestash(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[filestash-proxy] http://0.0.0.0:${PORT} → ${FILESTASH_ORIGIN.href}`);
});
