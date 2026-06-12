/**
 * Mission Control - Avatar Toggle UI
 *
 * Plain browser JS (no module system). Injects two buttons into the
 * Mission Control header so users can open either:
 *   - "Morgan (Standard)"  -> /voice          (existing Microsoft Speech Avatar)
 *   - "Mia Elegant (D-ID)" -> /voice/did      (new D-ID + ElevenLabs avatar)
 *
 * The D-ID button performs a lightweight readiness check against
 * /api/avatar/did/status before opening. If D-ID isn't configured the
 * user gets a clear alert and stays on the standard avatar.
 *
 * This file is intentionally not compiled by tsc. It is copied verbatim
 * to dist/mission/ by scripts/copy-static.cjs and served at
 * /mission/avatar-toggle-ui.js.
 */

(function initAvatarToggle() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAvatarToggle);
  } else {
    injectAvatarToggle();
  }

  function injectAvatarToggle() {
    var topActions = document.querySelector('header .top-actions');
    if (!topActions) {
      console.warn('[avatar-toggle] header .top-actions not found');
      return;
    }

    if (document.getElementById('avatar-toggle-control')) {
      // Already injected
      return;
    }

    var container = document.createElement('div');
    container.id = 'avatar-toggle-control';
    container.className = 'avatar-toggle-control';
    container.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:0 10px;border-left:1px solid var(--border);';

    var label = document.createElement('span');
    label.textContent = 'Avatar:';
    label.style.cssText =
      'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;';

    var btnMorgan = makeButton('Morgan (Standard)', '/voice');
    btnMorgan.id = 'avatar-open-morgan';
    btnMorgan.title = 'Open the existing Morgan voice + avatar experience';

    var btnDid = makeButton('Mia Elegant (D-ID)', '/voice/did');
    btnDid.id = 'avatar-open-did';
    btnDid.title = 'Open the new D-ID humanoid avatar (Mia Elegant + ElevenLabs)';
    btnDid.addEventListener('click', function (event) {
      event.preventDefault();
      checkDidReadyThenOpen('/voice/did');
    });

    container.appendChild(label);
    container.appendChild(btnMorgan);
    container.appendChild(btnDid);
    topActions.insertBefore(container, topActions.firstChild);

    console.log('[avatar-toggle] injected Morgan + D-ID buttons');
  }

  function makeButton(text, href) {
    var btn = document.createElement('a');
    btn.href = href;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.textContent = text;
    btn.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'padding:6px 10px;border-radius:6px;border:1px solid var(--border);' +
      'background:var(--panel-2);color:var(--text);font:inherit;font-size:12px;' +
      'text-decoration:none;cursor:pointer;transition:border-color 0.15s ease,background-color 0.15s ease;';
    btn.addEventListener('mouseover', function () {
      btn.style.borderColor = 'var(--teal)';
      btn.style.backgroundColor = 'var(--panel)';
    });
    btn.addEventListener('mouseout', function () {
      btn.style.borderColor = 'var(--border)';
      btn.style.backgroundColor = 'var(--panel-2)';
    });
    return btn;
  }

  function checkDidReadyThenOpen(url) {
    fetch('/api/avatar/did/status', { credentials: 'include' })
      .then(function (resp) {
        if (resp.status === 401) {
          // User is not signed in; let the avatar page itself handle the sign-in prompt
          window.open(url, '_blank', 'noopener');
          return null;
        }
        return resp.json().catch(function () {
          return null;
        });
      })
      .then(function (data) {
        if (data === undefined) return;
        if (data && data.available === false) {
          alert(
            'D-ID humanoid avatar is not configured on this deployment.\n\n' +
              'Required environment variables: DID_API_KEY, DID_CLIENT_KEY, DID_AGENT_ID, ELEVENLABS_API_KEY.\n\n' +
              'Falling back: use the "Morgan (Standard)" button to open the original avatar.'
          );
          return;
        }
        if (data === null) {
          window.open(url, '_blank', 'noopener');
          return;
        }
        window.open(url, '_blank', 'noopener');
      })
      .catch(function (err) {
        console.warn('[avatar-toggle] D-ID status check failed', err);
        // Still open the page; the page itself surfaces detailed errors
        window.open(url, '_blank', 'noopener');
      });
  }
})();
