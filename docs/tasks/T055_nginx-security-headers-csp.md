# T055 — Cabeceras de seguridad y CSP en nginx para la SPA

## Context

Hallazgo S2 de `docs/technical-review.md`: `frontend/nginx.conf` no emite
ninguna cabecera de seguridad. Django protege sus propias respuestas (`/api/`,
`/admin/`) pero el HTML de la SPA — donde un XSS haría el daño real, ver S1 —
se sirve desnudo. Plan: `docs/plans/technical-review-remediation.md`, oleada A.

**Dependencies**: None.

## Objective

Toda respuesta servida por el nginx de producción lleva CSP,
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` y
`Permissions-Policy`, y la app completa (SW, escáner WASM, push) sigue
funcionando bajo esa CSP, verificado con la suite E2E contra la imagen de
producción.

## Step 1 — Auditar qué necesita la CSP realmente

Antes de escribir la política, inspeccionar el build de producción:

```bash
docker run --rm -v "$PWD/frontend":/app -w /app node:24-alpine sh -c 'npm ci && npm run build'
grep -rn '<script' frontend/dist/index.html
grep -rn 'style=' frontend/dist/index.html | head
```

Puntos a comprobar:
- ¿`index.html` contiene `<script>` inline (vite-plugin-pwa a veces inyecta el
  registro del SW inline)? Si lo hay, anotar su contenido: la política usará
  un hash `'sha256-…'` para ese script concreto — **nunca** `unsafe-inline`.
- El escáner carga un `.wasm` same-origin → la CSP necesita
  `script-src` con `'wasm-unsafe-eval'` SOLO si el decoder usa
  instanciación que lo requiera; probarlo en el paso 4 antes de añadirlo.
- Las notificaciones push muestran iconos precacheados same-origin → cubierto
  por `img-src 'self'`.

## Step 2 — Definir las cabeceras en un include compartido

Crear `frontend/nginx-security-headers.conf` con las cabeceras (el include
evita el pitfall de nginx: `add_header` del bloque padre se descarta si el
hijo declara cualquier otro, como ya hace el bloque de assets con
`Cache-Control`):

```nginx
add_header Content-Security-Policy "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
```

(La política exacta se ajusta con lo aprendido en el paso 1: hashes de script
si los hay, `wasm-unsafe-eval` solo si el paso 4 lo demuestra necesario.
`camera=(self)` es imprescindible: el escáner de códigos la usa.)

En `frontend/nginx.conf`, añadir `include /etc/nginx/security-headers.conf;`
en el bloque `server` **y repetirlo** en el `location` de assets que ya
declara `add_header Cache-Control` (por la no-herencia citada). Actualizar
`frontend/Dockerfile` para copiar el include:

```dockerfile
COPY nginx-security-headers.conf /etc/nginx/security-headers.conf
```

Nota: `/api/` y `/admin/` son proxy a Django, que ya emite las suyas; no
duplicar cabeceras ahí (dos `X-Frame-Options` contradictorias es peor que una).

## Step 3 — Levantar la imagen de producción en local

```bash
docker build -t nudge-frontend-test -f frontend/Dockerfile frontend/
```

Levantar el compose de producción o un contenedor suelto conectado a la red
del compose de dev, mapeado a un puerto libre (p. ej. 18080), con
`NGINX_LOG_LEVEL=warn`. Verificar cabeceras:

```bash
curl -sI http://localhost:18080/ | grep -iE 'content-security|x-content-type|referrer|x-frame|permissions'
```

## Step 4 — Verificación funcional bajo CSP

1. Abrir la app servida por nginx en Chrome con DevTools → Console: **cero**
   errores `Refused to … because it violates the following Content Security
   Policy`.
2. Verificar manualmente: login, dashboard, abrir el escáner (fuerza la carga
   del `.wasm`), activar notificaciones push de prueba, poner el navegador
   offline y recargar (el SW debe servir la app).
3. Correr la suite E2E `chromium-preview` apuntando al contenedor nginx (o en
   su defecto contra `frontend-preview`, y la verificación nginx queda en el
   paso manual + curl):

```bash
docker run --rm --network host -e E2E_USERNAME=admin -e E2E_PASSWORD=adminpass -e DEMO_USERS_PASSWORD=change-me -e BASE_URL=http://localhost:14173 nudge-e2e npx playwright test --project=chromium-preview
```

Si algo rompe, ajustar la política (paso 1/2), **no** relajarla a
`unsafe-inline`/`unsafe-eval` globales.

## DoD — Definition of Done

1. `curl -sI` a la raíz del nginx de producción muestra las 5 cabeceras.
2. La CSP no contiene `unsafe-inline` ni `unsafe-eval` (se admite
   `wasm-unsafe-eval` solo si el paso 4 demostró que el decoder lo exige, con
   nota en el commit).
3. Consola del navegador sin violaciones CSP tras recorrer login, dashboard,
   escáner y push de prueba.
4. Suite E2E `chromium-preview` en verde (18 specs).
5. `docker compose --env-file .env -f dev/docker-compose.yml exec frontend npx vitest run` sigue en verde (sin cambios de app, sanity check).

## Evidence to produce

| # | Description | Command | File | PASS condition |
|---|-------------|---------|------|----------------|
| 1 | Cabeceras servidas | `curl -sI http://localhost:18080/ 2>&1` | `headers.txt` | Las 5 cabeceras presentes; CSP sin `unsafe-inline` |
| 2 | E2E preview | `docker run --rm --network host … nudge-e2e npx playwright test --project=chromium-preview 2>&1 \| tail -20` | `e2e_preview.txt` | "18 passed", 0 failed |
| 3 | Sin violaciones CSP | Captura o volcado de consola tras el recorrido manual del paso 4 | `csp_console.txt` | Ninguna línea "Refused to" |

## Files to create/modify

| File | Action |
|------|--------|
| `frontend/nginx-security-headers.conf` | CREATE |
| `frontend/nginx.conf` | MODIFY |
| `frontend/Dockerfile` | MODIFY |
