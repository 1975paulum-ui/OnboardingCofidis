# Demo Cofidis España · Namirial Onboarding

Web de demostración con los colores de Cofidis. Tres botones lanzan un flujo de verificación de identidad en Namirial Onboarding. La URL que devuelve la API se abre en un iframe, y a la derecha una consola muestra la llamada (estilo Postman), la respuesta y los webhooks en tiempo real.

```
Navegador ──POST /api/start──▶ server.js ──POST /requests──▶ Namirial Onboarding
    ▲                              ▲                                 │
    │   SSE /api/events            └──── POST /webhooks/namirial ◀───┘
    └────────────────────────────────────────────────────────────────
```

La clave de API nunca llega al navegador: la llamada a Namirial la hace el servidor, que devuelve a la web una "traza" con la clave enmascarada.

## Despliegue en Render

1. Sube esta carpeta a un repositorio de GitHub.
2. En Render: **New → Blueprint** (usa `render.yaml`) o **New → Web Service** con build `npm install` y start `npm start`.
3. Define las variables de entorno (ver `.env.example`):

| Variable | Qué es |
|---|---|
| `NAMIRIAL_API_KEY` | Token de la API. Va en la cabecera `X-Api-Key` en todas las llamadas |
| `NAMIRIAL_BASE_URL` | Por defecto `https://test-eu-ie1-api.namirialonboarding.com/api/v2` (servidor de test de la documentación) |
| `PUBLIC_URL` | URL pública de tu servicio en Render, sin barra final |
| `REQUEST_TYPE_IDSELF` / `_IDSELF_SIGN` / `_IDDOCCHECK` | Opcional. Ya vienen por defecto en `server.js`; solo para sobrescribirlos |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | Opcional. Protege la web (no afecta a webhooks ni al retorno) |
| `WEBHOOK_AUTH_HEADER` / `WEBHOOK_AUTH_VALUE` | Opcional. Cabecera secreta que se valida en los webhooks |
| `DEMO_EMAIL` / `DEMO_PHONE_NUMBER` | Contacto del firmante en el flujo ID SELF + SIGN (`parameters.email` y `parameters.phoneNumber`). El teléfono en formato internacional, p. ej. `+34600111222` |
| `NAMIRIAL_LANGUAGE` | Idioma del asistente (parámetro de consulta `language` de `POST /requests`). Por defecto `fr`; la documentación no lista los valores válidos, así que si no surte efecto prueba `fr-FR` |

Para probar en local: `npm install && node --env-file=.env server.js`.

## Registrar los webhooks (por request type)

Namirial asocia el webhook a cada **request type**, así que hay que registrarlo en los tres. La URL de destino es `https://TU-SERVICIO.onrender.com/webhooks/namirial`.

Lo más cómodo es el script incluido, que llama a `POST /requestType/{id}/webhookConfigurations` para los tres a la vez (con `PUBLIC_URL` y `NAMIRIAL_API_KEY` definidas en `.env`):

```bash
node --env-file=.env register-webhooks.mjs
```

Registra los temas `REQUEST_STATUS`, `REQUEST_LIFECYCLE` e `IDENTIFICATION_UPDATE`. Si defines `WEBHOOK_AUTH_VALUE`, también configura autenticación `CUSTOM_HEADERS` con la cabecera `WEBHOOK_AUTH_HEADER`, que el servidor valida al recibir. Namirial admite además `MTLS` y `OAUTH2_CC`, que este receptor no implementa.

Con curl, para un solo request type:

```bash
curl -X POST "$NAMIRIAL_BASE_URL/requestType/<REQUEST_TYPE_ID>/webhookConfigurations" \
  -H "Content-Type: application/json" -H "X-Api-Key: $NAMIRIAL_API_KEY" \
  -d '{ "url": "https://TU-SERVICIO.onrender.com/webhooks/namirial",
        "topics": ["REQUEST_STATUS", "REQUEST_LIFECYCLE"] }'
```

Después puedes enviar un evento de prueba con `POST /requestType/{id}/webhookConfiguration/{webhookConfigurationId}/test` y comprobar que aparece en la consola. Formato de un webhook (`type` y `status` varían):

```json
{
  "id": "…", "type": "STATUS_UPDATE", "createdAt": "2026-10-14T10:00:00Z",
  "request": { "requestId": "…", "requestTypeId": "…", "status": "COMPLETED" }
}
```

## Página de administración (`/admin.html`)

Comparte cabecera y consola con la demo. Cada acción lanza llamadas reales a la API de Namirial, y la consola de la derecha muestra cada una (método, URL, cabeceras, cuerpo y respuesta).

Para activarla, define `ADMIN_TOKEN` en Render. Al abrir la página, pide ese jeton y lo guarda solo en la sesión del navegador. Sin la variable, la administración queda desactivada.

| Sección | Qué permite |
|---|---|
| Parcours concernés | Elegir a qué request types se aplican las acciones |
| Webhooks | Listar, registrar (sin crear duplicados), enviar el test de Namirial, suprimir y reinicializar; elegir los topics; ver si alguna URL está registrada con `http://` |
| Paramètres du request type | Leer y modificar `requestSettingsDefault` (`GET/PUT /requestType/{id}/settings`) e insertar el `wizardUrlBack` de la demo |
| Demandes | Listar solicitudes, consultar una, ver sus identificaciones, anular (`userCancel`) o anonimizar |
| Démo et diagnostic | Cambiar en caliente el idioma, el email y el teléfono (en memoria), consultar la versión de la API, inyectar un webhook de prueba local y vaciar los webhooks recibidos |

El servidor solo reenvía a Namirial una lista cerrada de llamadas y solo para los request types de la demo. Si `WEBHOOK_AUTH_VALUE` está definida, el secreto lo añade el servidor y en la consola solo se ve un marcador.

## Puntos a vigilar

- **Iframe bloqueado.** Si la página de Namirial envía `X-Frame-Options` o `Content-Security-Policy: frame-ancestors`, el navegador no la mostrará dentro de tu web. Pide a Namirial que autorice tu dominio de Render. Mientras tanto, el botón "Abrir en pestaña nueva" sirve de salida.
- **Cámara dentro del iframe.** El iframe ya lleva `allow="camera; microphone; …"`. En móvil y en Safari conviene probarlo pronto.
- **Retorno al terminar.** La solicitud se crea con `settings.wizardUrlBack` apuntando a `/return`. Namirial sustituye `<requestId>`, `<status>`, etc. y redirige allí al usuario; esa página avisa a la consola ("retorno del usuario").
- **Plan gratuito de Render.** El servicio se duerme tras inactividad y tarda en despertar (decenas de segundos). Ábrelo antes de enseñarlo. Los webhooks se guardan solo en memoria (últimos 300) y se pierden al reiniciar.
- **Branding por flujo.** Como se comentó en la reunión, los colores, el logo y los textos de la pantalla de Namirial pertenecen al request type. Para que el iframe también se vea "Cofidis", pide a Namirial que configure ese branding en los tres.

## Personalización

- Colores de marca: variables `--brand*` al inicio de `public/index.html`. El rojo es un valor de referencia, sustitúyelo por el oficial.
- Wordmark: es texto. Para usar el logo oficial, cambia el `<span class="wordmark">` por un `<img>`.
- Nombres y descripciones de los botones: array `FLOWS` en `server.js`.
