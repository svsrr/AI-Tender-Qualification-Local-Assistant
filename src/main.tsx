import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Code that loads on first use (Excel and PDF export, among others) lives in files whose names
// change with every deploy. A page left open across a deploy still asks for the old names, which
// no longer exist, and the import fails ("Failed to fetch dynamically imported module"). Reload
// once to pick up the new version, then tell the engineer to repeat what they were doing.
// The time guard stops a reload loop if the files are genuinely unreachable.
const RELOADED_AT_KEY = 'app_reloaded_for_update_at';
const NOTICE_KEY = 'app_reload_notice';
window.addEventListener('vite:preloadError', (event) => {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOADED_AT_KEY)) || 0;
  } catch {
    // Storage unavailable: fall through and let the error surface.
  }
  if (Date.now() - last < 60_000) return;
  event.preventDefault();
  try {
    sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
    sessionStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Reload anyway.
  }
  window.location.reload();
});

try {
  if (sessionStorage.getItem(NOTICE_KEY)) {
    sessionStorage.removeItem(NOTICE_KEY);
    const note = document.createElement('div');
    note.textContent =
      'A new version of the app was published while this page was open, so it has been reloaded. Please repeat your last action (for example, the export).';
    note.setAttribute('role', 'status');
    note.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;max-width:560px;padding:10px 14px;' +
      'background:#1e3a8a;color:#fff;font:600 12px system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 10_000);
  }
} catch {
  // Notice only.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
