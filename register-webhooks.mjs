// Registra el webhook de la demo en los tres request types.
// Uso: node --env-file=.env register-webhooks.mjs
const env = process.env;
const val = (name, fallback) => (env[name] && env[name].trim() ? env[name].trim() : fallback);
const NAMIRIAL_API_KEY = val('NAMIRIAL_API_KEY');
const NAMIRIAL_BASE_URL = val('NAMIRIAL_BASE_URL', 'https://test-eu-ie1-api.namirialonboarding.com/api/v2');
const PUBLIC_URL = val('PUBLIC_URL');
const REQUEST_TYPE_FAST = val('REQUEST_TYPE_FAST', '2dd9eec0-1def-4a11-9f6c-ec2edd5c08de');
const REQUEST_TYPE_TRUST = val('REQUEST_TYPE_TRUST', '2fdd662c-6e20-4cf4-a02e-a59c7f74926f');
const REQUEST_TYPE_ETSI = val('REQUEST_TYPE_ETSI', '4bd2e4a9-7010-4a90-b4e4-912cd6782b22');
const WEBHOOK_AUTH_HEADER = val('WEBHOOK_AUTH_HEADER', 'x-webhook-secret');
const WEBHOOK_AUTH_VALUE = val('WEBHOOK_AUTH_VALUE');

if (!NAMIRIAL_API_KEY || !PUBLIC_URL) {
  console.error('Faltan NAMIRIAL_API_KEY y/o PUBLIC_URL');
  process.exit(1);
}

const base = NAMIRIAL_BASE_URL.replace(/\/+$/, '');
const url = `${PUBLIC_URL.replace(/\/+$/, '')}/webhooks/namirial`;

for (const id of [REQUEST_TYPE_FAST, REQUEST_TYPE_TRUST, REQUEST_TYPE_ETSI]) {
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
