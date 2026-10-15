import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = process.env;
// Una variable vacía (Render las crea en blanco) cuenta como no definida.
const val = (name, fallback) => (env[name] && env[name].trim() ? env[name].trim() : fallback);

const PORT = val('PORT', 3000);
const NAMIRIAL_API_KEY = val('NAMIRIAL_API_KEY');
// Servidor de test que figura en la documentación (OpenAPI 2.0.0)
const NAMIRIAL_BASE_URL = val('NAMIRIAL_BASE_URL', 'https://test-eu-ie1-api.namirialonboarding.com/api/v2');
// URL pública de este servicio, p. ej. https://cofidis-demo.onrender.com
const PUBLIC_URL = val('PUBLIC_URL');
// Request types de la demo; se pueden sobrescribir por variable de entorno.
const REQUEST_TYPE_IDSELF = val('REQUEST_TYPE_IDSELF', '3673aa11-3cf8-4fc9-9e3e-1ab22d2d4b41');
const REQUEST_TYPE_IDSELF_SIGN = val('REQUEST_TYPE_IDSELF_SIGN', 'fec0f3fe-60ac-46f2-a98e-1d457dab49cc');
const REQUEST_TYPE_IDDOCCHECK = val('REQUEST_TYPE_IDDOCCHECK', 'c54da3e2-4326-4ea5-811c-4f57b5214e65');
// Opcional: protege la demo con usuario/clave (no afecta a webhooks ni al retorno)
const BASIC_AUTH_USER = val('BASIC_AUTH_USER');
const BASIC_AUTH_PASS = val('BASIC_AUTH_PASS');
// Opcional: cabecera que Namirial enviará en los webhooks y que validamos
const WEBHOOK_AUTH_HEADER = val('WEBHOOK_AUTH_HEADER', 'x-webhook-secret');
const WEBHOOK_AUTH_VALUE = val('WEBHOOK_AUTH_VALUE');
// Opcional: activa las rutas de administración (/api/admin/...) protegidas por ?token=
const ADMIN_TOKEN = val('ADMIN_TOKEN');
// Datos de contacto que exige el flujo con firma (certificado de un solo uso).
// Namirial enviará ahí los códigos de verificación: pon un correo y un móvil a los que tengas acceso.
// Idioma del asistente de Namirial: parámetro `language` de POST /requests.
// La documentación no indica los valores admitidos; se prueba con 'fr' (alternativas: 'fr-FR', 'FR').
const NAMIRIAL_LANGUAGE = val('NAMIRIAL_LANGUAGE', 'fr');
const DEMO_EMAIL = val('DEMO_EMAIL');
const DEMO_PHONE_NUMBER = val('DEMO_PHONE_NUMBER'); // formato internacional, p. ej. +34600111222

const BASE = NAMIRIAL_BASE_URL.replace(/\/+$/, '');

// Los tres botones del menú. Edita nombres y descripciones a tu gusto.
const FLOWS = [
  {
    id: 'idself',
    name: 'ID SELF',
    desc: "Vérification d'identité avec pièce d'identité et selfie",
    level: 'Identité',
    requestTypeId: REQUEST_TYPE_IDSELF,
  },
  {
    id: 'idself-sign',
    name: 'ID SELF + SIGN',
    desc: "Vérification d'identité et signature électronique",
    level: 'Identité et signature',
    sendContact: true, // envía email y phoneNumber en `parameters`
    requestTypeId: REQUEST_TYPE_IDSELF_SIGN,
  },
  {
    id: 'iddoccheck',
    name: 'IDDocCheck',
    desc: "Vérification de la pièce d'identité",
    level: 'Document',
    requestTypeId: REQUEST_TYPE_IDDOCCHECK,
  },
];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // Render termina el TLS en su proxy
app.set('json spaces', 2);
app.use(express.json({ limit: '1mb' }));

/* ---------- Protección opcional con Basic Auth ---------- */
app.use((req, res, next) => {
  if (!BASIC_AUTH_USER) return next();
  const open =
    req.path.startsWith('/webhooks/') ||
    req.path === '/return' ||
    req.path === '/healthz';
  if (open) return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (u === BASIC_AUTH_USER && rest.join(':') === BASIC_AUTH_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Cofidis demo"');
  res.status(401).send('Accès restreint');
});

/* ---------- Utilidades ---------- */

/** Origen público de la demo. Fuera de localhost siempre https (Render redirige http con un 307
 *  que los emisores de webhooks no siguen). */
function publicOrigin(req) {
  const raw = (PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(raw);
  return local ? raw : raw.replace(/^http:\/\//, 'https://');
}

const maskKey = (v = '') => (v.length > 6 ? '••••••••' + v.slice(-4) : '••••••••');

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  WEBHOOK_AUTH_HEADER.toLowerCase(),
]);

function safeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? maskKey(String(v)) : v;
  }
  return out;
}

/**
 * Llama a la API de Namirial y devuelve, junto al resultado, una "traza"
 * estilo Postman (petición enviada + respuesta recibida) para mostrarla en la web.
 */
async function callNamirial({ method, pathname, query = {}, body }) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE}${pathname}${qs ? `?${qs}` : ''}`;
  const headers = {
    Accept: 'application/json',
    'X-Api-Key': NAMIRIAL_API_KEY || '',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const trace = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    request: {
      method,
      url,
      query,
      headers: safeHeaders(headers),
      body: body ?? null,
    },
    response: null,
  };

  const started = performance.now();
  try {
    const r = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* se deja como texto */
    }
    trace.response = {
      status: r.status,
      statusText: r.statusText,
      ms: Math.round(performance.now() - started),
      size: Buffer.byteLength(text),
      headers: Object.fromEntries(r.headers.entries()),
      body: parsed,
    };
    return { ok: r.ok, data: parsed, trace };
  } catch (err) {
    trace.response = {
      status: 0,
      statusText: 'Aucune réponse',
      ms: Math.round(performance.now() - started),
      size: 0,
      headers: {},
      body: {
        error: err.name === 'TimeoutError' ? 'Délai d\'attente dépassé' : String(err.message || err),
        // Node esconde el motivo real (DNS, TLS, conexión rechazada…) en `cause`
        cause: err.cause ? String(err.cause.code || err.cause.message || err.cause) : undefined,
        host: new URL(url).host,
      },
    };
    return { ok: false, data: null, trace };
  }
}

/** La respuesta de CreateRequest (v2) trae `links[]` con un enlace por actor. */
function pickLink(data) {
  if (data?.link) return data.link;
  const links = Array.isArray(data?.links) ? data.links : [];
  const mine = links.find((l) => l.actor === 'userToIdentify') || links[0];
  return mine?.link ?? null;
}

/* ---------- API para la web ---------- */
app.get('/api/flows', (_req, res) => {
  res.json({
    configured: Boolean(NAMIRIAL_API_KEY),
    publicUrl: PUBLIC_URL || null,
    baseUrl: BASE,
    flows: FLOWS.map(({ id, name, desc, level, requestTypeId }) => ({
      id,
      name,
      desc,
      level,
      ready: Boolean(requestTypeId),
    })),
  });
});

// Diagnóstico: GET /info/version es público y no necesita clave.
app.get('/api/ping', async (_req, res) => {
  const { ok, trace } = await callNamirial({ method: 'GET', pathname: '/info/version' });
  res.json({ ok, baseUrl: BASE, response: trace.response });
});

app.post('/api/start', async (req, res) => {
  const flow = FLOWS.find((f) => f.id === req.body?.flowId);
  if (!flow) return res.status(400).json({ error: 'Parcours inconnu' });
  if (!NAMIRIAL_API_KEY) return res.status(500).json({ error: 'NAMIRIAL_API_KEY est absente sur le serveur' });
  if (!flow.requestTypeId) {
    return res.status(500).json({ error: `Le requestTypeId du parcours « ${flow.name} » est absent des variables d'environnement` });
  }

  const origin = publicOrigin(req);
  const referenceId = `cofidis-demo-${Date.now()}`;

  // Namirial sustituye los marcadores <...> al redirigir al usuario cuando termina.
  const wizardUrlBack =
    `${origin}/return?requestId=<requestId>&referenceId=<referenceId>` +
    `&status=<status>&requestTypeId=<requestTypeId>&actor=<actor>`;

  const requestBody = {
    requestTypeId: flow.requestTypeId,
    referenceId,
    settings: { wizardUrlBack },
  };
  if (flow.sendContact) {
    const parameters = {};
    if (DEMO_EMAIL) parameters.email = DEMO_EMAIL;
    if (DEMO_PHONE_NUMBER) parameters.phoneNumber = DEMO_PHONE_NUMBER;
    if (Object.keys(parameters).length) requestBody.parameters = parameters;
  }

  const { ok, data, trace } = await callNamirial({
    method: 'POST',
    pathname: '/requests',
    query: { idempotencyKey: crypto.randomUUID(), language: NAMIRIAL_LANGUAGE },
    body: requestBody,
  });

  res.json({
    ok,
    flow: { id: flow.id, name: flow.name },
    requestId: data?.id ?? null,
    link: pickLink(data),
    trace,
  });
});

app.post('/api/status', async (req, res) => {
  const requestId = String(req.body?.requestId || '');
  if (!/^[0-9a-fA-F-]{8,64}$/.test(requestId)) return res.status(400).json({ error: 'requestId invalide' });
  const { ok, data, trace } = await callNamirial({
    method: 'GET',
    pathname: `/request/${requestId}`,
  });
  res.json({ ok, data, trace });
});

/* ---------- Administración de webhooks desde el navegador ---------- */
function adminOnly(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(404).json({ error: 'Rutas de administración desactivadas (falta ADMIN_TOKEN)' });
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ error: 'token incorrecto' });
  next();
}

// Lista los webhooks registrados en cada request type
app.get('/api/admin/webhooks', adminOnly, async (_req, res) => {
  const out = [];
  for (const f of FLOWS) {
    const { trace } = await callNamirial({ method: 'GET', pathname: `/requestType/${f.requestTypeId}/webhookConfigurations` });
    out.push({ flow: f.name, requestTypeId: f.requestTypeId, status: trace.response.status, body: trace.response.body });
  }
  res.json(out);
});

// Registra la URL de esta demo como webhook en los tres request types
app.get('/api/admin/register-webhooks', adminOnly, async (req, res) => {
  const origin = publicOrigin(req);
  const out = [];
  for (const f of FLOWS) {
    const body = {
      url: `${origin}/webhooks/namirial`,
      topics: ['REQUEST_STATUS', 'REQUEST_LIFECYCLE', 'IDENTIFICATION_UPDATE'],
    };
    if (WEBHOOK_AUTH_VALUE) {
      body.authentication = { type: 'CUSTOM_HEADERS', headers: { [WEBHOOK_AUTH_HEADER]: WEBHOOK_AUTH_VALUE } };
    }
    const { trace } = await callNamirial({ method: 'POST', pathname: `/requestType/${f.requestTypeId}/webhookConfigurations`, body });
    out.push({ flow: f.name, sent: body, status: trace.response.status, body: trace.response.body });
  }
  res.json(out);
});

// Lee requestSettingsDefault de cada request type (para ver qué campos admite de verdad)
app.get('/api/admin/settings', adminOnly, async (_req, res) => {
  const out = [];
  for (const f of FLOWS) {
    const { trace } = await callNamirial({ method: 'GET', pathname: `/requestType/${f.requestTypeId}/settings` });
    out.push({ flow: f.name, requestTypeId: f.requestTypeId, status: trace.response.status, body: trace.response.body });
  }
  res.json(out);
});

// Borra los webhooks de esta demo en los tres request types y los vuelve a crear con la URL https correcta
app.get('/api/admin/reset-webhooks', adminOnly, async (req, res) => {
  const origin = publicOrigin(req);
  const target = `${origin}/webhooks/namirial`;
  const out = [];
  for (const f of FLOWS) {
    const step = { flow: f.name, deleted: [], created: null };
    const list = await callNamirial({ method: 'GET', pathname: `/requestType/${f.requestTypeId}/webhookConfigurations` });
    const configs = Array.isArray(list.data?.content) ? list.data.content : [];
    for (const c of configs) {
      const id = c.id ?? c.webhookConfigurationId;
      if (!id || !String(c.url || '').includes('/webhooks/namirial')) continue;
      const del = await callNamirial({ method: 'DELETE', pathname: `/requestType/${f.requestTypeId}/webhookConfiguration/${id}` });
      step.deleted.push({ id, url: c.url, status: del.trace.response.status });
    }
    const body = { url: target, topics: ['REQUEST_STATUS', 'REQUEST_LIFECYCLE', 'IDENTIFICATION_UPDATE'] };
    if (WEBHOOK_AUTH_VALUE) {
      body.authentication = { type: 'CUSTOM_HEADERS', headers: { [WEBHOOK_AUTH_HEADER]: WEBHOOK_AUTH_VALUE } };
    }
    const add = await callNamirial({ method: 'POST', pathname: `/requestType/${f.requestTypeId}/webhookConfigurations`, body });
    step.created = { url: target, status: add.trace.response.status, body: add.trace.response.body };
    out.push(step);
  }
  res.json(out);
});

/* ---------- Webhooks entrantes + SSE ---------- */
const buffer = []; // últimos eventos en memoria
const MAX_BUFFER = 300;
const clients = new Set();

function publish(event) {
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  const payload = `event: webhook\ndata: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
}

app.post('/webhooks/namirial', (req, res) => {
  console.log(
    `[webhook] recibido type=${req.body?.type ?? '?'} requestId=${req.body?.request?.requestId ?? '?'} ` +
      `status=${req.body?.request?.status ?? '?'} auth=${WEBHOOK_AUTH_VALUE ? 'requerida' : 'no requerida'}`
  );
  if (WEBHOOK_AUTH_VALUE) {
    const got = req.get(WEBHOOK_AUTH_HEADER);
    if (got !== WEBHOOK_AUTH_VALUE) {
      console.warn('Webhook rechazado: cabecera de autenticación incorrecta');
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  publish({
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    source: 'webhook',
    headers: safeHeaders(req.headers),
    body: req.body ?? null,
  });
  res.status(200).json({ received: true });
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: init\ndata: ${JSON.stringify(buffer)}\n\n`);
  clients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

/* ---------- Páginas ---------- */
app.get('/return', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'return.html')));
app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Demo Cofidis escuchando en :${PORT}`);
  console.log(`API Namirial: ${BASE}`);
  if (!NAMIRIAL_API_KEY) console.warn('Aviso: NAMIRIAL_API_KEY no está definida');
});
