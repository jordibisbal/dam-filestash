(function () {
  'use strict';

  const CAPTION_API = '/api/plugin/caption';
  const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i;

  // ── Selected-file detection ──────────────────────────────────────────────────
  //
  // Filestash renders each file as:
  //   <a class="component_thing ... selected" data-path="/images/subdir/file.png">

  function selectedImagePaths() {
    const paths = [];
    document.querySelectorAll('a.component_thing.selected[data-path]').forEach(function (el) {
      const p = el.getAttribute('data-path');
      if (p && IMAGE_EXT.test(p)) paths.push(p);
    });
    return paths;
  }

  // ── Toolbar button injection ─────────────────────────────────────────────────
  //
  // The Filestash toolbar is:
  //   <div class="component_submenu container" role="toolbar">
  //     <div class="action left no-select">
  //       <button data-action="download">Download</button>
  //       <button data-action="delete">Remove</button>
  //       ...
  //     </div>
  //   </div>
  //
  // We inject our button after the last existing left-side button and show/hide
  // it based on whether selected files contain images.

  var captionBtn = null;

  function createBtn() {
    var b = document.createElement('button');
    b.setAttribute('data-action', 'caption');
    b.textContent = 'Caption';
    b.addEventListener('click', onCaptionClick);
    return b;
  }

  function ensureBtnInToolbar() {
    var leftBar = document.querySelector('.component_submenu .action.left');
    if (!leftBar) return false;
    if (leftBar.querySelector('[data-action="caption"]')) return true;
    captionBtn = createBtn();
    leftBar.appendChild(captionBtn);
    return true;
  }

  function refresh() {
    // Pause the observer for the entire refresh to prevent DOM mutations we
    // make here (appendChild, textContent, style) from re-triggering refresh.
    observer.disconnect();
    try {
      if (!ensureBtnInToolbar()) return;
      var paths = selectedImagePaths();
      if (paths.length > 0) {
        captionBtn.style.display = '';
        captionBtn.textContent = 'Caption (' + paths.length + ')';
      } else {
        captionBtn.style.display = 'none';
      }
    } finally {
      observer.observe(document.body, OBSERVER_OPTS);
    }
  }

  // ── Caption action ───────────────────────────────────────────────────────────

  async function onCaptionClick() {
    var paths = selectedImagePaths();
    if (paths.length === 0) return;

    captionBtn.disabled = true;
    captionBtn.textContent = 'Sending\u2026';

    var sent = 0, failed = 0;

    for (var i = 0; i < paths.length; i++) {
      var filePath = paths[i];
      var jobId = 'caption-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      var imagePath = '/app' + filePath;
      try {
        var resp = await fetch(CAPTION_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, image_path: imagePath }),
        });
        if (resp.ok) { sent++; } else { failed++; }
      } catch (_) {
        failed++;
      }
    }

    captionBtn.textContent = failed === 0
      ? '\u2713 ' + sent + ' sent'
      : sent + ' sent, ' + failed + ' failed';

    // Deselect all selected items.
    document.querySelectorAll('a.component_thing.selected').forEach(function (el) {
      el.classList.remove('selected');
    });

    setTimeout(function () {
      captionBtn.disabled = false;
      refresh();
    }, 2500);
  }

  // ── Info-panel caption injection ─────────────────────────────────────────────
  //
  // When the user opens an image and clicks the info (ℹ) icon, Filestash shows
  // #pane-info with EXIF data.  We append the AI caption beneath it by calling
  // GET /api/metadata?path=<current-file-path>.
  //
  // The file path comes from location.pathname: /files/images/foo.jpg
  //   → strip /files prefix → /images/foo.jpg (what the metadata API expects).

  var lastInfoPath = null;

  function infoFilePath() {
    var p = location.pathname.replace(/^\/files/, '');
    return IMAGE_EXT.test(p) ? p : null;
  }

  async function injectCaption(pane) {
    var filePath = infoFilePath();
    if (!filePath || filePath === lastInfoPath) return;
    lastInfoPath = filePath;

    // Remove any previously injected caption row.
    var old = pane.querySelector('[data-caption-plugin]');
    if (old) old.remove();

    var resp;
    try {
      resp = await fetch('/api/metadata?path=' + encodeURIComponent(filePath));
      if (!resp.ok) return;
    } catch (_) { return; }

    var data;
    try { data = await resp.json(); } catch (_) { return; }

    var results = (data && data.results) || [];
    var captionEl = results.find(function (r) { return r.id === 'caption'; });
    if (!captionEl || !captionEl.value) return;

    var row = document.createElement('div');
    row.setAttribute('data-caption-plugin', '1');
    row.setAttribute('style', 'padding: 10px 15px; border-top: 1px solid var(--border, #e0e0e0);');
    row.innerHTML =
      '<div style="font-size:0.75em;color:var(--light,#888);margin-bottom:4px;">AI Caption</div>' +
      '<div style="font-size:0.85em;line-height:1.4;">' + captionEl.value.replace(/</g, '&lt;') + '</div>';

    // Append after the last content_box, or at the end of the pane body.
    var body = pane.querySelector('[data-bind="body"]') || pane;
    body.appendChild(row);
  }

  // ── Observer ─────────────────────────────────────────────────────────────────
  //
  // Watch for toolbar appearance (SPA navigation), selection changes,
  // and info-panel appearance.

  var OBSERVER_OPTS = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  };

  var observer = new MutationObserver(function () {
    refresh();
    var pane = document.getElementById('pane-info');
    if (pane) injectCaption(pane);
  });

  function start() {
    observer.observe(document.body, OBSERVER_OPTS);
    refresh();
  }

  if (document.body) { start(); }
  else { document.addEventListener('DOMContentLoaded', start); }

  window.addEventListener('hashchange', function () {
    lastInfoPath = null;
    refresh();
  });

}());
