/* Consola de integración compartida por la demo (index.html) y la administración (admin.html).
   Muestra las llamadas a la API (estilo Postman) y los webhooks que llegan en directo. */

// state.apiHintKey permite a cada página elegir su texto de ayuda (clave de i18n)

/* ============ Utilidades ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (iso) => new Date(iso).toLocaleTimeString(localeTag(), { hour12: false });
const bytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function hl(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  if (s === undefined || s === null || s === '') return `<span class="muted">${esc(t('con.empty'))}</span>`;
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    if (m[1]) out += m[2] ? `<span class="k">${esc(m[1])}</span>${esc(m[2])}` : `<span class="s">${esc(m[1])}</span>`;
    else if (m[3]) out += `<span class="b">${m[3]}</span>`;
    else out += `<span class="n">${m[0]}</span>`;
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}

function kvTable(obj) {
  const rows = Object.entries(obj || {});
  if (!rows.length) return `<p class="hint">${esc(t('con.noData'))}</p>`;
  return `<table class="kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</table>`;
}

function toCurl(c) {
  const parts = [`curl -X ${c.request.method} '${c.request.url}'`];
  for (const [k, v] of Object.entries(c.request.headers)) {
    parts.push(k.toLowerCase() === 'x-api-key' ? `-H 'X-Api-Key: $NAMIRIAL_API_KEY'` : `-H '${k}: ${v}'`);
  }
  if (c.request.body) parts.push(`-d '${JSON.stringify(c.request.body).replace(/'/g, `'\\''`)}'`);
  return parts.join(' \\\n  ');
}


/* ============ Estado ============ */
const state = {
  flows: [],
  activeFlow: null,
  calls: [],
  selected: null,
  reqId: null,
  events: [],
  showAll: false,
  open: new Set(),
  fresh: new Set(),
  live: false,
  reqTab: 'body',
  resTab: 'body',
};

/* ============ Consola: llamadas ============ */
function addCall(trace) {
  state.calls.push(trace);
  state.selected = trace.id;
  state.reqTab = trace.request.body ? 'body' : 'params';
  state.resTab = 'body';
  renderChips();
  renderApi();
}

function renderChips() {
  $('#chips').innerHTML = state.calls.map((c, i) => {
    const p = new URL(c.request.url).pathname.replace(/^.*\/api\/v2/, '');
    return `<button class="chip" data-call="${c.id}" type="button" aria-pressed="${state.selected === c.id}">
      <span class="m ${c.request.method}">${c.request.method}</span>${esc(p.length > 22 ? p.slice(0, 21) + '…' : p)}</button>`;
  }).join('');
}

function renderApi() {
  const pane = $('#apiPane');
  const c = state.calls.find((x) => x.id === state.selected);
  if (!c) {
    pane.innerHTML = `<div class="pane-title"><h3>${esc(t('con.callAndResp'))}</h3></div>
      <p class="hint">${esc(t(state.apiHintKey || 'con.hintDefault'))}</p>`;
    return;
  }
  const q = c.request.query || {};
  const hdr = c.request.headers || {};
  const res = c.response;
  const cls = res.status >= 200 && res.status < 300 ? 'ok' : res.status === 0 ? 'err' : res.status < 500 ? 'warn' : 'err';

  const reqPane =
    state.reqTab === 'params' ? kvTable(q) :
    state.reqTab === 'headers' ? kvTable(hdr) :
    `<pre class="code">${hl(c.request.body)}</pre>`;
  const resPane =
    state.resTab === 'headers' ? kvTable(res.headers) : `<pre class="code">${hl(res.body)}</pre>`;

  const tab = (group, key, label, n) =>
    `<button class="tab" role="tab" data-group="${group}" data-tab="${key}" aria-selected="${state[group + 'Tab'] === key}">${label}${n != null ? `<span class="n">${n}</span>` : ''}</button>`;

  pane.innerHTML = `
    <div class="pane-title"><h3>${esc(t('con.call'))}</h3><button class="cbtn" id="btnCurl" type="button">${esc(t('con.copyCurl'))}</button></div>
    <div class="reqbar"><span class="m ${c.request.method}">${c.request.method}</span><span class="u">${esc(c.request.url)}</span></div>
    <div class="tabs" role="tablist">
      ${tab('req', 'params', 'Params', Object.keys(q).length)}
      ${tab('req', 'headers', 'Headers', Object.keys(hdr).length)}
      ${tab('req', 'body', 'Body')}
    </div>
    ${reqPane}

    <div class="pane-title" style="margin-top:18px">
      <h3>${esc(t('con.response'))}</h3>
      <span class="status"><span class="st ${cls}">${res.status || esc(t('con.error'))} ${esc(res.statusText || '')}</span><span class="muted">${res.ms} ms</span><span class="muted">${bytes(res.size)}</span></span>
    </div>
    <div class="tabs" role="tablist">
      ${tab('res', 'body', 'Body')}
      ${tab('res', 'headers', 'Headers', Object.keys(res.headers || {}).length)}
    </div>
    ${resPane}`;
}

/* ============ Consola: webhooks ============ */
// Busca el requestId en cualquier parte del payload, para no depender de su estructura exacta
function mentionsRequest(e, reqId) {
  try { return JSON.stringify(e.body).includes(reqId); } catch { return false; }
}

function badgeFor(e) {
  if (e.source === 'return') return `<span class="badge ret">${esc(t('con.returnBadge'))}</span>`;
  const st = (e.body?.request?.status || '').toUpperCase();
  if (!st) return '';
  const good = ['COMPLETED', 'APPROVED', 'ACCEPTED', 'FINALIZED'];
  const bad = ['REJECTED', 'FAILED', 'ERROR', 'EXPIRED', 'CANCELLED', 'CANCELED'];
  const cls = good.includes(st) ? 'good' : bad.includes(st) ? 'bad' : 'mid';
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}

function renderWebhooks() {
  const pane = $('#whPane');
  const list = state.events.filter((e) => state.showAll || !state.reqId || mentionsRequest(e, state.reqId));
  const hidden = state.events.length - list.length;

  const items = list.slice().reverse().map((e) => {
    const open = state.open.has(e.id);
    const title = e.source === 'return' ? 'wizardUrlBack' : (e.body?.type || 'webhook');
    const payload = e.source === 'return' ? e.body : e.body;
    return `<li class="wh ${state.fresh.has(e.id) ? 'fresh' : ''}">
      <button class="wh-head" data-ev="${esc(e.id)}" type="button" aria-expanded="${open}">
        <span class="wh-time">${clock(e.receivedAt)}</span>
        <span class="wh-type">${esc(title)}</span>
        ${badgeFor(e)}
      </button>
      <div class="wh-body" ${open ? '' : 'hidden'}>
        <pre class="code">${hl(payload)}</pre>
      </div>
    </li>`;
  }).join('');

  pane.innerHTML = `
    <div class="pane-title">
      <h3>${esc(t('con.whTitle'))} <span class="muted">(${list.length})</span></h3>
      <span class="live"><span class="dot ${state.live ? 'on' : ''}"></span>${esc(state.live ? t('con.live') : t('con.reconnecting'))}</span>
    </div>
    <div class="wh-tools" style="margin-bottom:10px">
      <label><input type="checkbox" id="chkAll" ${state.showAll ? 'checked' : ''}> ${esc(t('con.showAll'))}${hidden > 0 && !state.showAll ? ' ' + esc(t('con.hidden', { n: hidden })) : ''}</label>
    </div>
    ${items ? `<ul class="wh-list">${items}</ul>` :
      `<p class="hint">${esc(t('con.whHint'))}</p>`}`;
}

function pushEvent(e, fresh) {
  if (state.events.some((x) => x.id === e.id)) return;
  state.events.push(e);
  if (fresh) {
    state.fresh.add(e.id);
    setTimeout(() => { state.fresh.delete(e.id); }, 2000);
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('init', (ev) => {
    state.live = true;
    JSON.parse(ev.data).forEach((e) => pushEvent(e, false));
    renderWebhooks();
  });
  es.addEventListener('webhook', (ev) => {
    pushEvent(JSON.parse(ev.data), true);
    renderWebhooks();
  });
  es.addEventListener('clear', () => {
    state.events = [];
    state.open.clear();
    renderWebhooks();
  });
  es.onerror = () => { state.live = false; renderWebhooks(); };
  es.onopen = () => { state.live = true; renderWebhooks(); };
}

/* ============ Eventos de la consola ============ */
document.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-call]');
  if (chip) { state.selected = chip.dataset.call; renderChips(); renderApi(); return; }

  const tab = e.target.closest('[data-tab]');
  if (tab) { state[tab.dataset.group + 'Tab'] = tab.dataset.tab; renderApi(); return; }

  const ev = e.target.closest('[data-ev]');
  if (ev) {
    const id = ev.dataset.ev;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    renderWebhooks();
    return;
  }

  if (e.target.id === 'btnCurl') {
    const c = state.calls.find((x) => x.id === state.selected);
    if (c) { await navigator.clipboard.writeText(toCurl(c)); e.target.textContent = t('con.copied'); setTimeout(() => (e.target.textContent = t('con.copyCurl')), 1500); }
    return;
  }

  if (e.target.id === 'btnClear') {
    state.calls = []; state.selected = null; state.events = []; state.open.clear();
    renderChips(); renderApi(); renderWebhooks();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'chkAll') { state.showAll = e.target.checked; renderWebhooks(); }
});
