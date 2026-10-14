import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  PORT = 3000,
  NAMIRIAL_API_KEY,
  // Servidor de test que figura en la documentación (OpenAPI 2.0.0)
  NAMIRIAL_BASE_URL = 'https://test-eu-ie1-api.namirialonboarding.com/api/v2',
  // URL pública de este servicio, p. ej. https://cofidis-demo.onrender.com
  PUBLIC_URL,
  // Por defecto, los request types de la demo. Se pueden sobrescribir por variable de entorno.
  REQUEST_TYPE_FAST = '2dd9eec0-1def-4a11-9f6c-ec2edd5c08de',
  REQUEST_TYPE_TRUST = '2fdd662c-6e20-4cf4-a02e-a59c7f74926f',
  REQUEST_TYPE_ETSI = '4bd2e4a9-7010-4a90-b4e4-912cd6782b22',
  // Opcional: protege la demo con usuario/clave (no afecta a webhooks ni al retorno)
  BASIC_AUTH_USER,
  BASIC_AUTH_PASS,
  // Opcional: cabecera que Namirial enviará en los webhooks y que validamos
  WEBHOOK_AUTH_HEADER = 'x-webhook-secret',
  WEBHOOK_AUTH_VALUE,
} = process.env;

const BASE = NAMIRIAL_BASE_URL.replace(/\/+$/, '');

// Los tres botones del menú. Edita nombres y descripciones a tu gusto.
const FLOWS = [
  {
    id: 'fast',
    name: 'ID Self Fast',
    desc: 'Controles automáticos y prueba de vida pasiva',
    level: 'Nivel sustancial',
    requestTypeId: REQUEST_TYPE_FAST,
  },
  {
    id: 'trust',
    name: 'ID Self Trust',
    desc: 'Controles automáticos y revisión humana',
    level: 'Nivel alto',
    requestTypeId: REQUEST_TYPE_TRUST,
  },
  {
    id: 'etsi',
    name: 'ID Self Trust ETSI 119 461',
    desc: 'Revisión humana y reto activo de prueba de vida',
    level: 'Certificado ETSI',
    requestTypeId: REQUEST_TYPE_ETSI,
  },
];

const app = express();
app.disable('x-powered-by');
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
  res.status(401).send('Acceso restringido');
});

/* ---------- Utilidades ---------- */
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
      statusText: 'Sin respuesta',
      ms: Math.round(performance.now() - started),
      size: 0,
      headers: {},
      body: { error: err.name === 'TimeoutError' ? 'Tiempo de espera agotado' : String(err.message || err) },
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
    flows: FLOWS.map(({ id, name, desc, level, requestTypeId }) => ({
      id,
      name,
      desc,
      level,
      ready: Boolean(requestTypeId),
    })),
  });
});

app.post('/api/start', async (req, res) => {
  const flow = FLOWS.find((f) => f.id === req.body?.flowId);
  if (!flow) return res.status(400).json({ error: 'Flujo desconocido' });
  if (!NAMIRIAL_API_KEY) return res.status(500).json({ error: 'Falta NAMIRIAL_API_KEY en el servidor' });
  if (!flow.requestTypeId) {
    return res.status(500).json({ error: `Falta el requestTypeId del flujo "${flow.name}" en las variables de entorno` });
  }

  const origin = (PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const referenceId = `cofidis-demo-${Date.now()}`;

  // Namirial sustituye los marcadores <...> al redirigir al usuario cuando termina.
  const wizardUrlBack =
    `${origin}/return?requestId=<requestId>&referenceId=<referenceId>` +
    `&status=<status>&requestTypeId=<requestTypeId>&actor=<actor>`;

  const { ok, data, trace } = await callNamirial({
    method: 'POST',
    pathname: '/requests',
    query: { idempotencyKey: crypto.randomUUID() },
    body: {
      requestTypeId: flow.requestTypeId,
      referenceId,
      settings: { wizardUrlBack },
    },
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
  if (!/^[0-9a-fA-F-]{8,64}$/.test(requestId)) return res.status(400).json({ error: 'requestId no válido' });
  const { ok, data, trace } = await callNamirial({
    method: 'GET',
    pathname: `/request/${requestId}`,
  });
  res.json({ ok, data, trace });
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
  if (WEBHOOK_AUTH_VALUE) {
    const got = req.get(WEBHOOK_AUTH_HEADER);
    if (got !== WEBHOOK_AUTH_VALUE) {
      console.warn('Webhook rechazado: cabecera de autenticación incorrecta');
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  publish({
    id: req.body?.id || crypto.randomUUID(),
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
