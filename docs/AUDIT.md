# Nudge — Auditoría completa del proyecto

Fecha: 2026-02-27

Checklist de problemas identificados, ordenados por severidad.
Marcar con `[x]` a medida que se resuelvan.

---

## HIGH — Arreglar antes de considerar esto producción estable

### H1. Fallos silenciosos en mutaciones del frontend

- [x] Resuelto

**Ubicación:** `frontend/src/pages/RoutineFormPage.jsx` (línea ~107),
`DashboardPage.jsx` (`markDone`), `RoutineDetailPage.jsx` (`markDone`, `toggleActive`),
`InventoryPage.jsx` (`create`)

**Problema:** Si la llamada API falla, el botón simplemente se re-habilita y no se
muestra ningún mensaje de error. El usuario cree que su acción funcionó cuando no fue
así. Para una app de recordatorios donde "marcar como hecho" es la acción central,
esto es un bug funcional.

**Acción:** Mostrar feedback de error al usuario en todas las operaciones de mutación.
Un toast, un mensaje inline, o al menos un `alert()`.

---

### H2. Linting NO está en CI

- [x] Resuelto

**Ubicación:** `.github/workflows/ci.yml`

**Problema:** El pre-commit hook corre ruff y eslint, pero el pipeline de CI no.
Si alguien hace push sin el hook (clone fresco, `--no-verify`, commit desde GitHub web),
las violaciones de linting llegan a main sin control.

**Acción:** Añadir steps de `ruff check .` y `npx eslint src/` al workflow de CI.

---

### ~~H3. Weekly rebuild publica sin tests~~

- [x] Descartado — documentado en `.github/workflows/weekly-rebuild.yml`

El rebuild semanal solo actualiza dependencias transitivas y parches de imagen base.
El código no cambia, por lo que el CI ya validó la lógica. Añadir tests al rebuild
retrasaría la actualización de seguridad sin beneficio real.

---

### H4. Sin health check en backend/celery (producción)

- [x] Resuelto

**Ubicación:** `docker-compose.yml`

**Problema:** Hay health checks en db, redis y frontend, pero NO en backend ni celery.
El endpoint `/api/health/` existe en el código pero no se usa. Si gunicorn arranca pero
la app está rota (migración fallida, BD inalcanzable), el frontend empieza a servir
tráfico hacia un backend muerto.

**Acción:** Añadir health check al servicio backend:
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/')"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## MEDIUM — Deberían arreglarse

### M1. N+1 queries en backend

- [x] Resuelto

**Ubicación:** `backend/apps/routines/models.py` (`Stock.quantity` property),
`backend/apps/routines/serializers.py` (`get_has_expiring_lots`, `get_expiring_lots`),
`backend/apps/routines/views.py` (lista de rutinas sin prefetch de entries)

**Problema:**
- `Stock.quantity` hace `aggregate(Sum)` que bypasea el prefetch cache → 1 query/stock.
- `get_has_expiring_lots` y `get_expiring_lots` usan `.filter()` sobre lots prefetcheados
  → bypasea el cache → 2 queries extra/stock.
- La lista de rutinas (`/api/routines/`) no hace prefetch de entries → `last_entry()`
  dispara 1 query/rutina.

Con 10 usuarios es imperceptible. Con 100 y muchas rutinas, se notará.

**Acción:** Anotar queries con `Subquery`/`Prefetch` con querysets limitados, o
filtrar sobre el cache de Python en vez de hacer `.filter()` en el ORM.

---

### M2. `push.js` bypasea el API client

- [x] Resuelto

**Ubicación:** `frontend/src/utils/push.js`

**Problema:** Usa `fetch` directo con URLs hardcodeadas (`/api/push/...`) en vez
del client con token refresh. Si el access token expiró, subscribe/unsubscribe
fallan con 401 sin reintento. Además no verifica el status de la respuesta del backend.

**Acción:** Migrar a usar `api.post`/`api.delete` del client centralizado.

---

### M3. Race condition en token refresh

- [x] Resuelto

**Ubicación:** `frontend/src/api/client.js`

**Problema:** Si dos requests devuelven 401 simultáneamente, ambas intentan refresh
en paralelo. La segunda falla porque el refresh token ya fue consumido (con
`ROTATE_REFRESH_TOKENS = True`).

**Acción:** Implementar un mutex o queue de refresh: la primera 401 lanza el refresh,
las demás esperan a que termine y usan el nuevo token.

---

### M4. `localStorage.clear()` en logout

- [x] Resuelto

**Ubicación:** `frontend/src/contexts/AuthContext.jsx` (logout),
`frontend/src/api/client.js` (on 401)

**Problema:** `localStorage.clear()` borra TODO localStorage, incluyendo preferencias
de i18n y cualquier otro dato persistido.

**Acción:** Usar `localStorage.removeItem('access_token')` +
`localStorage.removeItem('refresh_token')` en su lugar.

---

### M5. `BLACKLIST_AFTER_ROTATION = False` en JWT

- [x] Resuelto

**Ubicación:** `backend/nudge/settings.py` (SIMPLE_JWT config)

**Problema:** Los refresh tokens rotados siguen siendo válidos. Si uno se filtra, el
atacante puede seguir usándolo indefinidamente incluso después de que el usuario
legítimo haya rotado.

**Acción:** Añadir `rest_framework_simplejwt.token_blacklist` a `INSTALLED_APPS`,
correr la migración, y poner `BLACKLIST_AFTER_ROTATION = True`.

---

### M6. Sin rate limiting en login

- [x] Resuelto

**Ubicación:** `backend/apps/users/urls.py` — `/api/auth/token/`

**Problema:** No hay throttling en el endpoint de login. Brute-force viable.

**Acción:** Usar el throttling de DRF con una clase custom para auth endpoints,
o añadir `django-ratelimit`.

---

### M7. Sin rotación de logs Docker

- [x] Resuelto

**Ubicación:** `docker-compose.yml`

**Problema:** Los contenedores en el NAS corren 24/7 sin configurar `max-size` ni
`max-file` en el logging driver. Eventualmente llenará disco.

**Acción:** Añadir a cada servicio (o como default en el daemon):
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

---

### M8. Sin resource limits en contenedores

- [x] Resuelto

**Ubicación:** `docker-compose.yml`

**Problema:** Cero `mem_limit`/`cpus` en ningún servicio. En un NAS con recursos
limitados, un leak de memoria en Celery o Postgres puede tumbar todo el sistema.

**Acción:** Añadir límites razonables. Ejemplo:
```yaml
backend:
  mem_limit: 512m
celery:
  mem_limit: 512m
db:
  mem_limit: 512m
redis:
  mem_limit: 128m
frontend:
  mem_limit: 128m
```

---

### M9. Tarea Celery: excepción en una rutina aborta el resto del usuario

- [x] Resuelto

**Ubicación:** `backend/apps/notifications/tasks.py`

**Problema:** No hay `try/except` alrededor del procesamiento individual de cada rutina.
Si `notify_due()` o `notify_reminder()` lanza una excepción inesperada (ej: error de BD),
se aborta el procesamiento de TODAS las rutinas restantes de ese usuario.

**Acción:** Envolver el procesamiento de cada rutina en un `try/except` con logging
del error, para que un fallo en una rutina no bloquee las demás.

---

### M10. Task helper bypasea prefetch cache con `.filter()`

- [x] Resuelto

**Ubicación:** `backend/apps/notifications/tasks.py` — `_check_daily_heads_up` (línea ~84)
y loop principal (línea ~45)

**Problema:** El loop exterior hace `prefetch_related("routines")`, pero después
`user.routines.filter(is_active=True)` bypasea el prefetch cache y lanza una query
extra por usuario.

**Acción:** Filtrar en Python sobre las rutinas ya prefetcheadas, o usar
`Prefetch("routines", queryset=Routine.objects.filter(is_active=True))`.

---

### M11. Sin `AUTH_PASSWORD_VALIDATORS` en Django

- [x] Resuelto

**Ubicación:** `backend/nudge/settings.py`

**Problema:** El cambio de contraseña solo valida `len >= 8`. No hay check de passwords
comunes, numéricos, o similares al username. Django trae validators por defecto que
están desactivados.

**Acción:** Añadir los validators estándar de Django:
```python
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
```
Y usar `validate_password()` en la vista `change_password` en vez de `len(new) < 8`.

---

## LOW — Nice to have

### L1. `STATICFILES_STORAGE` deprecado en Django 5.x

- [x] Resuelto

**Ubicación:** `backend/nudge/settings.py:93`

**Problema:** `STATICFILES_STORAGE` está deprecado. Django 5.x quiere `STORAGES`.

**Acción:** Migrar a:
```python
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

---

### L2. `language` no está en `UserAdmin.fieldsets`

- [x] Resuelto

**Ubicación:** `backend/apps/users/admin.py` (líneas 10-17)

**Problema:** El campo `language` del usuario no aparece en el Django Admin.
No se puede editar el idioma de un usuario desde el panel de administración.

**Acción:** Añadir `"language"` al fieldset "Nudge settings" del `UserAdmin`.

---

### L3. `stock_usage` permite valor 0

- [x] Resuelto

**Ubicación:** `backend/apps/routines/models.py` (campo `stock_usage`)

**Problema:** `PositiveIntegerField(default=1)` sin `MinValueValidator`. Un valor
de 0 hace que loguear una rutina no decremente stock, lo cual puede ser confuso.

**Acción:** Si no es intencional, añadir `MinValueValidator(1)`.

---

### L4. Sin `CSRF_TRUSTED_ORIGINS` en producción

- [x] Resuelto

**Ubicación:** `backend/nudge/settings.py`

**Problema:** `CSRF_TRUSTED_ORIGINS` solo se configura en debug mode. El Django Admin
usa session auth y podría necesitarlo si se accede a través del dominio del proxy.

**Acción:** Añadir `CSRF_TRUSTED_ORIGINS` configurable desde `.env` para producción.

---

### L5. Dependencia `dj-database-url` sin usar

- [x] Resuelto

**Ubicación:** `backend/requirements.txt`

**Problema:** `dj-database-url` está en requirements pero `django-environ` es el que
realmente parsea `DATABASE_URL`. Dependencia muerta.

**Acción:** Eliminar `dj-database-url` de `requirements.txt`.

---

### L6. `gcc` innecesario en imagen de producción backend

- [x] Resuelto

**Ubicación:** `backend/Dockerfile`

**Problema:** `psycopg2-binary` trae wheels precompilados y no necesita `gcc`.
Queda instalado en la imagen final añadiendo ~50MB de peso muerto. Además, no es
multi-stage build.

**Acción:** Probar a eliminar `gcc` del Dockerfile. Si el build funciona sin él,
eliminarlo. Opcionalmente, considerar multi-stage build.

---

### ~~L7. Patrón fetch/loading/error duplicado en todas las pages~~

- [x] Descartado — cada page tiene variaciones suficientes (pagination, Promise.all,
  re-fetches tras mutaciones) como para que un hook genérico no aporte claridad.
  El patrón de 4 líneas es legible y explícito.

---

### L8. "Mark as done" en notificación no ejecuta la acción

- [x] Resuelto

**Ubicación:** `frontend/src/sw.js` (handler de `notificationclick`)

**Problema:** El action "Mark as done" en la notificación push solo abre la página
de la rutina. No hace POST a `/api/routines/:id/log/`. El usuario espera que al
pulsar "Marcar como hecho" se ejecute la acción directamente.

**Acción:** Hacer `fetch` al endpoint de log desde el service worker en el handler
de `notificationclick` cuando la action es `mark-done`.

---

### L9. `LOCALE_MAP` / `getLocale` duplicado

- [x] Resuelto

**Ubicación:** `frontend/src/pages/HistoryPage.jsx` (líneas 8, 104-106),
`frontend/src/utils/time.js` (líneas 3-7)

**Problema:** Copy-paste del mapa de locales y la función helper.

**Acción:** Usar la versión de `utils/time.js` en `HistoryPage`.

---

### L10. `ud.` hardcodeado en InventoryPage

- [x] Resuelto

**Ubicación:** `frontend/src/pages/InventoryPage.jsx` (línea ~194)

**Problema:** La abreviatura de "unidades" está hardcodeada en español.
Debería ser una key de i18n.

**Acción:** Crear key de traducción y usarla en lugar del string literal.

---

### L11. CSS: botones compartidos sin usar

- [x] Resuelto

**Ubicación:** `frontend/src/styles/shared.module.css`

**Problema:** Define `.btnPrimary`, `.btnSecondary`, `.btnDanger` que ningún
componente importa. Cada page define sus propios estilos de botón casi idénticos.

**Acción:** Migrar los estilos de botón de cada page a usar los compartidos,
o eliminar los compartidos si no se van a usar.

---

### L12. Formato de fecha inconsistente en frontend

- [x] Resuelto

**Ubicación:** `frontend/src/pages/RoutineDetailPage.jsx` (línea ~110)

**Problema:** Usa `new Date(e.created_at).toLocaleString()` sin locale explícito,
mientras que `HistoryPage` y `utils/time.js` usan locales explícitos.

**Acción:** Usar `getLocale()` de `utils/time.js` consistentemente.

---

### L13. `ChangePasswordModal` embebido en `Header.jsx`

- [x] Resuelto

**Ubicación:** `frontend/src/components/Header.jsx` (líneas 80-158)

**Problema:** Un formulario completo con su propio estado, llamada API, error handling
y feedback de éxito vive dentro del componente Header. Son dos responsabilidades
distintas en un solo archivo.

**Acción:** Extraer `ChangePasswordModal` a su propio archivo de componente.

---

### L14. Nav links sin `aria-label` en mobile

- [x] Resuelto

**Ubicación:** `frontend/src/components/Layout.jsx`

**Problema:** En mobile los nav links son solo iconos (los labels se ocultan).
No hay `aria-label`, por lo que los screen readers no pueden identificar la
navegación.

**Acción:** Añadir `aria-label` a cada nav link.

---

### L15. Sin Prettier en frontend

- [x] Resuelto

**Ubicación:** `frontend/`

**Problema:** No hay formatter configurado para JavaScript/JSX. El estilo de código
puede divergir entre colaboradores.

**Acción:** Añadir Prettier con config y añadirlo al pre-commit hook.

---

### L16. `BACKEND_PORT` desacoplado de nginx

- [x] Resuelto

**Ubicación:** `docker-compose.yml` (variable `BACKEND_PORT`),
`frontend/nginx.conf` (hardcoded `backend:8000`)

**Problema:** La variable `BACKEND_PORT` configura gunicorn, pero nginx tiene
hardcodeado `proxy_pass http://backend:8000`. Si alguien cambia el puerto,
nginx no conecta.

**Acción:** Documentar claramente que no se debe cambiar, o usar envsubst en
nginx.conf para inyectar el puerto dinámicamente.

---

### L17. Redis sin password

- [x] Resuelto (parcial: Redis bindeado a 127.0.0.1 en dev)

**Ubicación:** `docker-compose.yml`, `dev/docker-compose.yml`

**Problema:** Redis corre sin autenticación. En producción está aislado en la red
Docker (bajo riesgo), pero en dev se expone en `0.0.0.0:6379`.

**Acción:** Añadir `requirepass` en Redis y actualizar `CELERY_BROKER_URL` /
`REDIS_URL` con la password. Como mínimo, bindear Redis a `127.0.0.1` en dev.

---

### L18. Pluralización rota en intervalos

- [x] Resuelto

**Ubicación:** `frontend/src/pages/RoutineDetailPage.jsx` (`formatInterval`)

**Problema:** Muestra "Every 1 days" en vez de "Every 1 day". Las translation keys
usan `{{n}} days/hours` sin lógica de pluralización.

**Acción:** Usar la interpolación con pluralización de i18next (`_one` / `_other`).
