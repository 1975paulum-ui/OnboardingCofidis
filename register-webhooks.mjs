// Registra el webhook de la demo en los tres request types.
// Uso: node --env-file=.env register-webhooks.mjs
const env = process.env;
const val = (name, fallback) => (env[name] && env[name].trim() ? env[name].trim() : fallback);
const NAMIRIAL_API_KEY = val('NAMIRIAL_API_KEY');
const NAMIRIAL_BASE_URL = val('NAMIRIAL_BASE_URL', 'https://test-eu-ie1-api.namirialonboarding.com/api/v2');
const PUBLIC_URL = val('PUBLIC_URL');
const REQUEST_TYPE_IDSELF = val('REQUEST_TYPE_IDSELF', '3673aa11-3cf8-4fc9-9e3e-1ab22d2d4b41');
const REQUEST_TYPE_IDSELF_SIGN = val('REQUEST_TYPE_IDSELF_SIGN', 'fec0f3fe-60ac-46f2-a98e-1d457dab49cc');
const REQUEST_TYPE_IDDOCCHECK = val('REQUEST_TYPE_IDDOCCHECK', 'c54da3e2-4326-4ea5-811c-4f57b5214e65');
const WEBHOOK_AUTH_HEADER = val('WEBHOOK_AUTH_HEADER', 'x-webhook-secret');
const WEBHOOK_AUTH_VALUE = val('WEBHOOK_AUTH_VALUE');

if (!NAMIRIAL_API_KEY || !PUBLIC_URL) {
  console.error('Faltan NAMIRIAL_API_KEY y/o PUBLIC_URL');
  process.exit(1);
}

const base = NAMIRIAL_BASE_URL.replace(/\/+$/, '');
const url = `${PUBLIC_URL.replace(/\/+$/, '')}/webhooks/namirial`;

for (const id of [REQUEST_TYPE_IDSELF, REQUEST_TYPE_IDSELF_SIGN, REQUEST_TYPE_IDDOCCHECK]) {
  const body = {
    url,
    topics: ['REQUEST_STATUS', 'REQUEST_LIFECYCLE', 'IDENTIFICATION_UPDATE'],
  };
  if (WEBHOOK_AUTH_VALUE) {
    body.authentication = { type: 'CUSTOM_HEADERS', headers: { [WEBHOOK_AUTH_HEADER]: WEBHOOK_AUTH_VALUE } };
  }
  const r = await fetch(`${base}/requestType/${id}/webhookConfigurations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': NAMIRIAL_API_KEY },
    body: JSON.stringify(body),
  });
  console.log(id, '→', r.status, (await r.text()).slice(0, 300));
}
