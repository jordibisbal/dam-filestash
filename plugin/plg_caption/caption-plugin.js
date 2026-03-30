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

    setTimeout(function () {
      captionBtn.disabled = false;
      refresh();
    }, 2500);
  }

  // ── Observer ─────────────────────────────────────────────────────────────────
  //
  // Watch for toolbar appearance (SPA navigation) and selection changes.

  var OBSERVER_OPTS = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  };

  var observer = new MutationObserver(refresh);

  function start() {
    observer.observe(document.body, OBSERVER_OPTS);
    refresh();
  }

  if (document.body) { start(); }
  else { document.addEventListener('DOMContentLoaded', start); }

  window.addEventListener('hashchange', refresh);

}());
