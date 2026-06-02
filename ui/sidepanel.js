/**
 * InstaGhost — Side Panel controller (Driver A).
 * Drives content/ig-driver.js via chrome.tabs.sendMessage and renders the states:
 *   off-IG · on-IG (hint) · ready · running (step-rail) · done · errors.
 * The outcome arrives via broadcast (ig_progress / ig_result), not via sendResponse:
 * a sendResponse does not survive a scrape that takes minutes.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const panel = $('panel');
  if (!panel) return;

  const hasChrome = typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime;

  const el = {
    pill: $('igPill'), pillTx: $('igPillTx'),
    lede: $('igLede'), rule: $('igRule'), alert: $('igAlert'),
    form: $('igForm'), offig: $('igOffig'), progress: $('igProgress'), result: $('igResult'),
    handle: $('igHandle'), detected: $('igDetected'),
    limit: $('igLimit'), minus: $('igMinus'), plus: $('igPlus'),
    comments: $('igCommentsToggle'), media: $('igMediaToggle'), extractBtn: $('igExtractBtn'),
    openIg: $('igOpenIg'),
    runWho: $('igRunWho'), fill: $('igFill'), abort: $('igAbort'),
    st1: $('igSt1'), st2: $('igSt2'), st3: $('igSt3'),
    ic1: $('igIc1'), ic2: $('igIc2'), ic3: $('igIc3'),
    sub1: $('igSub1'), sub2: $('igSub2'), sub3: $('igSub3'),
    resWho: $('igResWho'), resMeta: $('igResMeta'), saved: $('igSaved'),
    copy: $('igCopy'), dlMd: $('igDlMd'), dlJson: $('igDlJson'), again: $('igAgain'),
    reset: $('igReset'), toastWrap: $('toastWrap'),
  };

  // icons used for alerts / steps (monoline, currentColor)
  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-.5 4M20 5v6h-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  };

  let busy = false;       // extraction in progress
  let aborting = false;   // the user pressed Cancel → discard the incoming result
  let screen = 'idle';    // idle | offig | running | done | error
  let last = null;        // { handle, markdown, json, filenameBase }

  // ---------- UI helpers ----------
  const setPill = (tone, text) => { el.pill.dataset.tone = tone; el.pillTx.textContent = text; };

  function vis({ lede = 0, rule = 0, form = 0, offig = 0, progress = 0, result = 0 } = {}) {
    el.lede.style.display = lede ? '' : 'none';
    el.rule.style.display = rule ? '' : 'none';
    el.form.style.display = form ? '' : 'none';
    el.offig.style.display = offig ? '' : 'none';
    el.progress.style.display = progress ? '' : 'none';
    el.result.style.display = result ? '' : 'none';
  }

  const clearAlert = () => { el.alert.innerHTML = ''; };
  function setAlert(tone, icon, title, desc) {
    el.alert.innerHTML =
      `<div class="alert"${tone ? ` data-tone="${tone}"` : ''} role="status">${icon}` +
      `<div><span class="a-t">${title}</span><span class="a-d">${desc}</span></div></div>`;
  }

  function setStep(n, state, sub) {
    const st = el['st' + n], ic = el['ic' + n];
    st.className = 'st' + (state ? ' ' + state : '');
    ic.innerHTML = state === 'done' ? ICON.check : String(n);
    if (sub !== undefined) el['sub' + n].textContent = sub;
  }

  function toast(msg, ms = 2600) {
    if (!el.toastWrap) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toastWrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, ms);
  }

  function clampLimit() {
    let n = parseInt(el.limit.value, 10);
    if (isNaN(n)) n = 60;
    n = Math.max(1, Math.min(1000, n));
    el.limit.value = n;
    return n;
  }

  function formatK(n) {
    if (n == null || isNaN(n)) return null;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e) { return false; }
    }
  }

  // ---------- views ----------
  function renderReady(handle, detected) {
    screen = 'idle';
    setPill('ok', handle ? '@' + handle : 'on a profile');
    clearAlert();
    el.detected.style.display = detected ? '' : 'none';
    vis({ lede: 1, rule: 1, form: 1 });
  }

  function renderHint() {
    screen = 'idle';
    setPill('ok', 'on Instagram');
    el.detected.style.display = 'none';
    setAlert('', ICON.info, 'Go to a profile',
      'Open an Instagram profile for auto-detection, or type the handle below.');
    vis({ lede: 1, rule: 1, form: 1 });
  }

  function renderOffig() {
    screen = 'offig';
    setPill('warn', 'not on Instagram');
    clearAlert();
    vis({ offig: 1 });
  }

  function renderRunning(handle) {
    screen = 'running';
    setPill('busy', 'extracting');
    clearAlert();
    el.runWho.textContent = '@' + handle;
    setStep(1, 'active', '—'); setStep(2, '', '—'); setStep(3, '', '—');
    el.fill.style.width = '0%';
    vis({ progress: 1 });
  }

  function renderError(kind, msg = {}) {
    screen = 'error';
    busy = false;
    const handle = msg.handle || (el.handle.value || '').trim().replace(/^@/, '');
    if (kind === 'private') {
      setPill('warn', 'private profile');
      setAlert('warn', ICON.lock, `@${handle || 'profile'} is private`,
        'Its posts can’t be read: Instagram only shows them to approved followers.');
    } else if (kind === 'rate') {
      setPill('warn', 'rate-limited');
      setAlert('warn', ICON.clock, 'Instagram slowed us down',
        'Too many requests in a short time. Wait a few minutes and try again: the anti-detection recovers on its own.');
    } else if (kind === 'reload') {
      setPill('warn', 'reload the tab');
      setAlert('warn', ICON.refresh, 'Reload the Instagram page',
        'The tab is no longer responding to the panel. Refresh instagram.com (F5) and try again.');
    } else {
      setPill('warn', 'error');
      setAlert('warn', ICON.warn, 'Extraction failed',
        (msg.error ? String(msg.error) : 'Unknown error') + '. Try again.');
    }
    vis({ form: 1 }); // no lede/rule: focus on the alert + retry
  }

  function renderDone(msg) {
    screen = 'done';
    busy = false;
    setPill('ok', 'done');
    el.resWho.textContent = '@' + msg.handle;
    const parts = [`<span class="res-meta-strong">${msg.count} posts</span>`];
    if (msg.commentsCount) parts.push(`${msg.commentsCount} comments`);
    if (msg.placesCount) parts.push(`${msg.placesCount} places`);
    const f = formatK(msg.followers);
    if (f) parts.push(`${f} followers`);
    el.resMeta.innerHTML = parts.join(' · ');
    el.saved.textContent = msg.mediaCount > 0
      ? `.md and .json saved · downloading ${msg.mediaCount} photos/videos…`
      : 'already saved to your Downloads folder';
    vis({ result: 1 });
  }

  // ---------- chrome plumbing ----------
  const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const onInstagram = tab => !!tab && /^https:\/\/www\.instagram\.com\//.test(tab.url || '');

  async function detect() {
    if (!hasChrome) { setPill('', 'mockup'); renderReady('', false); return; }
    if (busy || screen === 'done') return; // don't disturb running/done
    try {
      const tab = await activeTab();
      if (!onInstagram(tab)) { renderOffig(); return; }
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'ig_detect' }).catch(() => null);
      if (res && res.isProfile) {
        if (!el.handle.value.trim()) el.handle.value = res.handle;
        renderReady(res.handle, true);
      } else {
        renderHint(); // on IG but not on a profile (or content-script not ready yet)
      }
    } catch (_) {
      renderHint();
    }
  }

  async function extract() {
    if (busy || !hasChrome) return;
    const handle = (el.handle.value || '').trim().replace(/^@/, '').replace(/[/?].*$/, '');
    if (!handle) { toast('Type or open a profile'); el.handle.focus(); return; }
    const tab = await activeTab();
    if (!onInstagram(tab)) { renderOffig(); return; }

    busy = true; aborting = false; last = null;
    el.extractBtn.disabled = true;
    renderRunning(handle);

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'ig_extract',
        handle,
        limit: clampLimit(),
        withComments: !el.comments.classList.contains('off'),
        withMedia: !el.media.classList.contains('off'),
      });
    } catch (e) {
      busy = false; el.extractBtn.disabled = false;
      renderError('reload');
    }
  }

  async function abortRun() {
    if (!busy || !hasChrome) return;
    aborting = true; busy = false; el.extractBtn.disabled = false;
    try {
      const tab = await activeTab();
      if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'ig_abort' }).catch(() => {});
    } catch (_) {}
    toast('Extraction cancelled');
    detect();
  }

  async function openInstagram() {
    if (!hasChrome) return;
    try { await chrome.tabs.create({ url: 'https://www.instagram.com/' }); } catch (_) {}
  }

  // reset: clears anti-detection state (storage) + DB (no-op on the SW side); does NOT touch downloaded files
  async function resetAll() {
    if (!hasChrome || busy) return;
    if (!window.confirm('Reset InstaGhost?\n\nClears the locally saved anti-detection state (fatigue/backoff).\nFiles already downloaded are NOT touched.')) return;
    try {
      try { await chrome.runtime.sendMessage({ action: 'clear_data' }); } catch (_) {}
      try { await chrome.storage.local.remove(['monitoringActive', 'seenPostUrls', 'pendingPosts', 'instaGhost_rateLimiter']); } catch (_) {}
      last = null;
      toast('Reset complete');
      detect();
    } catch (e) { toast('Reset failed'); }
  }

  // ---------- broadcast listener (progress + result) ----------
  if (hasChrome) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;

      if (msg.action === 'ig_progress') {
        if (!busy) return;
        if (msg.phase === 'profile') {
          setStep(1, 'done', 'read'); setStep(2, 'active', '—');
          el.fill.style.width = '8%';
        } else if (msg.phase === 'posts') {
          setStep(1, 'done', 'read');
          setStep(2, 'active', `${msg.collected} / ${msg.limit}`);
          el.fill.style.width = Math.min(60, (msg.collected / msg.limit) * 60) + '%';
        } else if (msg.phase === 'comments') {
          setStep(2, 'done', 'done');
          setStep(3, 'active', `${msg.done} / ${msg.total}`);
          el.fill.style.width = (60 + (msg.done / msg.total) * 40) + '%';
        }
        return;
      }

      if (msg.action === 'ig_result') {
        if (aborting) { aborting = false; return; } // cancelled by the user
        busy = false; el.extractBtn.disabled = false;
        if (msg.success) {
          if ((msg.count === 0) && msg.note) { renderError('private', msg); return; }
          last = { handle: msg.handle, markdown: msg.markdown, json: msg.json, filenameBase: msg.filenameBase };
          renderDone(msg);
        } else if (msg.status === 429) {
          renderError('rate', msg);
        } else {
          renderError('generic', msg);
        }
        return;
      }

      if (msg.action === 'ig_media_progress') {
        if (screen === 'done') el.saved.textContent = `downloading photos/videos… ${msg.done}/${msg.total}`;
        return;
      }
      if (msg.action === 'ig_media_done') {
        if (screen === 'done') {
          const where = (last && last.handle) ? '@' + last.handle + '/' : 'Downloads';
          el.saved.textContent = msg.failed
            ? `${msg.ok} media saved (${msg.failed} failed) in ${where}`
            : `${msg.ok} photos/videos saved in ${where}`;
        }
        return;
      }
    });
  }

  // ---------- wiring ----------
  el.minus.addEventListener('click', () => { el.limit.value = Math.max(1, (parseInt(el.limit.value, 10) || 60) - 5); });
  el.plus.addEventListener('click', () => { el.limit.value = Math.min(1000, (parseInt(el.limit.value, 10) || 60) + 5); });
  el.limit.addEventListener('change', clampLimit);
  el.comments.addEventListener('click', () => el.comments.classList.toggle('off'));
  el.media.addEventListener('click', () => el.media.classList.toggle('off'));
  el.extractBtn.addEventListener('click', extract);
  el.openIg.addEventListener('click', openInstagram);
  el.abort.addEventListener('click', abortRun);

  el.copy.addEventListener('click', async () => {
    if (!last) return;
    const ok = await copyText(last.markdown);
    const label = el.copy.querySelector('svg') ? el.copy : null;
    el.copy.textContent = ok ? '✓ Copied to clipboard' : '✗ Copy failed';
    el.copy.classList.toggle('btn-primary', ok);
    el.copy.classList.toggle('btn-copy', !ok);
    setTimeout(() => {
      el.copy.classList.remove('btn-primary'); el.copy.classList.add('btn-copy');
      el.copy.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> Copy the Markdown';
    }, 1800);
  });
  el.dlMd.addEventListener('click', () => { if (last) downloadText(last.filenameBase + '.md', last.markdown, 'text/markdown'); });
  el.dlJson.addEventListener('click', () => { if (last) downloadText(last.filenameBase + '.json', last.json, 'application/json'); });
  el.again.addEventListener('click', () => { el.fill.style.width = '0%'; detect(); });
  el.reset.addEventListener('click', resetAll);

  // ---------- init ----------
  if (hasChrome) {
    detect();
    try {
      chrome.tabs.onActivated.addListener(detect);
      chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') detect(); });
    } catch (_) {}
  } else {
    setPill('', 'mockup');
    renderReady('', false);
  }
})();
