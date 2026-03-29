(function () {
  'use strict';

  const CAPTION_API = '/api/plugin/caption';
  const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i;

  // ── Floating button ──────────────────────────────────────────────────────────

  const btn = document.createElement('button');
  btn.id = 'caption-plugin-btn';
  Object.assign(btn.style, {
    display:      'none',
    position:     'fixed',
    bottom:       '24px',
    right:        '24px',
    zIndex:       '99999',
    padding:      '10px 18px',
    background:   '#0d7d2e',
    color:        '#fff',
    border:       'none',
    borderRadius: '6px',
    fontSize:     '13px',
    fontWeight:   '600',
    cursor:       'pointer',
    boxShadow:    '0 2px 8px rgba(0,0,0,.4)',
    whiteSpace:   'nowrap',
    fontFamily:   'sans-serif',
  });

  function mountBtn() {
    if (document.body) { document.body.appendChild(btn); }
    else { setTimeout(mountBtn, 50); }
  }
  mountBtn();

  // ── Selected-file detection ──────────────────────────────────────────────────
  //
  // Filestash renders each file as:
  //   <a class="component_thing ... selected" data-path="/images/subdir/file.png">
  // The data-path starts with /images/... (relative to /srv/ inside the container).

  function selectedImagePaths() {
    const paths = [];
    document.querySelectorAll('a.component_thing.selected[data-path]').forEach(function (el) {
      const p = el.getAttribute('data-path');
      if (p && IMAGE_EXT.test(p)) paths.push(p);
    });
    return paths;
  }

  // ── Refresh button visibility ────────────────────────────────────────────────

  let currentPaths = [];

  function refresh() {
    currentPaths = selectedImagePaths();
    if (currentPaths.length > 0) {
      btn.textContent = '\uD83D\uDCF8 CAPTION (' + currentPaths.length + ')';
      btn.style.display = 'block';
    } else {
      btn.style.display = 'none';
    }
  }

  const observer = new MutationObserver(refresh);
  function startObserver() {
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  if (document.body) { startObserver(); }
  else { document.addEventListener('DOMContentLoaded', startObserver); }

  window.addEventListener('hashchange', refresh);

  // ── Caption action ───────────────────────────────────────────────────────────

  btn.addEventListener('click', async function () {
    const paths = currentPaths.slice();
    if (paths.length === 0) return;

    btn.disabled = true;
    btn.style.background = '#555';
    btn.textContent = '\u23F3 Sending ' + paths.length + '\u2026';

    let sent = 0, failed = 0;

    for (const filePath of paths) {
      const jobId = 'caption-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      // data-path is /images/... → captioner mount is /app/images/...
      const imagePath = '/app' + filePath;
      try {
        const resp = await fetch(CAPTION_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, image_path: imagePath }),
        });
        if (resp.ok) { sent++; } else { failed++; }
      } catch (_) {
        failed++;
      }
    }

    if (failed === 0) {
      btn.style.background = '#1a7f37';
      btn.textContent = '\u2705 ' + sent + ' job' + (sent !== 1 ? 's' : '') + ' sent';
    } else {
      btn.style.background = '#d73a49';
      btn.textContent = '\u26A0 ' + sent + ' sent, ' + failed + ' failed';
    }

    setTimeout(function () {
      btn.disabled = false;
      btn.style.background = '#0d7d2e';
      refresh();
    }, 3000);
  });

}());
