// Registra el webhook de la demo en los tres request types.
// Uso: node --env-file=.env register-webhooks.mjs
const {
  NAMIRIAL_API_KEY,
  NAMIRIAL_BASE_URL = 'https://test-eu-ie1-api.namirialonboarding.com/api/v2',
  PUBLIC_URL,
  REQUEST_TYPE_FAST = '2dd9eec0-1def-4a11-9f6c-ec2edd5c08de',
  REQUEST_TYPE_TRUST = '2fdd662c-6e20-4cf4-a02e-a59c7f74926f',
  REQUEST_TYPE_ETSI = '4bd2e4a9-7010-4a90-b4e4-912cd6782b22',
  WEBHOOK_AUTH_HEADER = 'x-webhook-secret',
  WEBHOOK_AUTH_VALUE,
} = process.env;

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
