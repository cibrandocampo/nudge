# Remediación de la revisión técnica (plan maestro)

## Context

`docs/technical-review.md` (2026-08-09) identificó 20 hallazgos de seguridad,
arquitectura, integridad de datos y calidad, con 4 de severidad alta:

- **S1** — JWT en `localStorage` con refresh de 60 días y logout sin revocación.
- **S2** — La SPA se sirve sin cabeceras de seguridad (sin CSP).
- **C1** — `consume_lots` registra consumos mayores que lo realmente descontado.
- **C2** — El middleware de idempotencia ejecuta la vista dos veces bajo carrera.

Este documento es el **plan maestro** que ordena toda la remediación en oleadas
(A–J). Cada oleada es autocontenida, deja `main` desplegable al terminar y se
convertirá en su propio lote de tareas vía `/dev-2-tasks` (una invocación por
oleada, no una para todo el plan). El detalle de diseño aquí es proporcional al
riesgo: las oleadas invasivas (B, D, J) llevan diseño conceptual completo; las
mecánicas (A, G) solo el qué y el porqué.

Los identificadores S*/A*/C*/Q*/T*/I* referencian los hallazgos de
`docs/technical-review.md`.

## Decisions confirmed with user

| Topic | Decision |
|-------|----------|
| Alcance | Plan maestro de todo el roadmap (10 fases → oleadas A–J), no un plan por bloque |
| C1 (invariante de consumo) | Backend **y** frontend en la misma oleada: el 422 nuevo se maneja en modal/toast/cola offline desde el primer despliegue |
| S1 (tokens JWT) | Completo: logout con revocación **y** migración del refresh token a cookie httpOnly (oleadas C y J) |
| C4 / S5 (matriz de permisos, enumeración de emails) | Se cierran como documentación + tests dentro de este plan (oleada C) |

## Design proposal

### Oleada A — Cabeceras de seguridad e higiene (S2, S7, Q4)

**Cabeceras en nginx** (`frontend/nginx.conf`): bloque de `add_header` aplicado
a las respuestas HTML del SPA:

- `Content-Security-Policy`: `default-src 'self'`; `connect-src 'self'` (la API
  es mismo origen tanto en dev —proxy de Vite— como en prod —proxy nginx—);
  `img-src 'self' data:`; `worker-src 'self'` (service worker);
  `manifest-src 'self'`. Verificación previa obligatoria: confirmar que el
  build de Vite + vite-plugin-pwa no emite scripts/estilos inline (si los
  emite, se resuelve con hashes en la CSP, nunca con `unsafe-inline`).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy` restrictiva (cámara solo self — el escáner la usa).
- Nota: `add_header` en nginx no se hereda entre bloques si el hijo declara
  otros; se definirá en un include compartido para evitar el clásico olvido.

**Higiene**: añadir `*.pem` y `celerybeat-schedule` a `.gitignore`; borrar
`backend/private_key.pem`, `backend/public_key.pem`, `backend/celerybeat-schedule`
y el directorio residual `frontend/e2e/` del árbol de trabajo.

La verificación de la CSP incluye una pasada E2E completa: el service worker,
el escáner (WASM), y las notificaciones push son los candidatos a romperse.

### Oleada B — Invariante de consumo y excepciones de dominio (C1, C3, A1)

**Excepciones de dominio** (`apps/routines/exceptions.py`):

- `InsufficientStock(requested, available)` — no hay unidades suficientes.
- `InvalidLotSelection(reason)` — selección malformada (ids inválidos,
  duplicados, suma incorrecta).

Ambas heredan de `Exception` puro (sin DRF). Un `exception_handler`
personalizado de DRF (registrado en `REST_FRAMEWORK`) las traduce:
`InsufficientStock` → **422** con el shape que ya usa el pre-check de `log()`
(`{detail, code: "insufficient_stock", required, available}`);
`InvalidLotSelection` → **400**. `models.py` deja de importar
`rest_framework.serializers`.

**Invariante en `Stock.consume_lots`**: al terminar cualquiera de los dos
caminos (FEFO o selección explícita), si `sum(consumido) != quantity` se lanza
`InsufficientStock` y la transacción hace rollback. El pre-check de
`RoutineViewSet.log` se mantiene como cortesía de UX (respuesta rápida sin
tocar lotes) pero deja de ser la única defensa: la carrera TOCTOU ahora termina
en 422 correcto, nunca en auditoría falsa.

**Validación de entrada** (`ConsumeInputSerializer`): `quantity`
(`IntegerField(min_value=1)`) y `lot_selections` (lista opcional de
`{lot_id, quantity}` con rechazo de `lot_id` duplicados). Lo usan
`StockViewSet.consume` y `RoutineViewSet.log`; desaparece el `int(request.data...)`
manual de la vista y la validación estructural que hoy vive en el modelo.

**Frontend**: el error 422 `insufficient_stock` ya existe para `log` (el
frontend actual lo conoce); lo nuevo es que `consume` también puede devolverlo
y que ambos pueden llegar **tras reintento offline**:

- `useConsumeStock` / `useLogRoutine`: en el camino online, un 422 revierte el
  update optimista (el rollback ya existe, `registerRollback('consumeStock')`)
  y muestra toast con el mensaje "stock insuficiente (quedan N)".
- Cola offline (`offline/sync.js`): 422 ya cae en la rama "otros 4xx → entrada
  `error`" y el usuario la descarta desde PendingBadge, aplicando el rollback
  registrado. Se añade el `labelKey` apropiado para que el motivo sea legible.
- `LotConsumeModal`: cap del stepper a `quantity_available` ya existe; se
  añade el manejo del error para el caso de datos desactualizados.

### Oleada C — Endurecimiento de auth y decisiones escritas (S1-fase 1, S3, S4, C4, S5)

**Logout con revocación**: endpoint `POST /api/auth/logout/` que recibe el
refresh token y lo blacklistea (`rest_framework_simplejwt.token_blacklist`,
ya instalado). `AuthContext.logout()` lo llama antes de limpiar el estado
local (fire-and-forget si está offline: la limpieza local no debe bloquearse).

**Gate del seed** (`SeedView`): la ruta `internal/seed/` se registra en
`urls.py` **solo** cuando `DEBUG=True` o `E2E_SEED_ALLOWED=true`; además el
comando `seed` aborta si detecta > 10 usuarios con `auth_method='otp'`
(heurística "esto parece producción real"). Doble candado.

**Throttles**: `UserRateThrottle` (p. ej. `5/hour`) en `change_password`;
contador de fallos por usuario en el camino password de `login_verify`
reutilizando el patrón de `LoginCode.attempts` (campo `failed_login_attempts`
+ ventana, o modelo pequeño equivalente — decisión de detalle para la tarea).

**Documentación de decisiones** (`docs/permissions-and-privacy.md`):

- Matriz owner/shared por recurso y verbo HTTP (incluidas las asimetrías
  actuales: crear lote = owner-only, editar/borrar lote = cualquier compartido;
  PATCH de notas de entrada = cualquier compartido, DELETE = owner). Cada celda
  intencional se congela con un test; cada celda que se decida cambiar genera
  un ítem nuevo (fuera de esta oleada).
- Postura ante enumeración de emails en `login/start` y `contacts/`
  (aceptada para instancia pequeña/familiar, con el razonamiento).

### Oleada D — Idempotencia sin carrera (C2)

Se invierte el orden de operaciones del middleware a **reserva primero**:

1. `INSERT` del `IdempotencyRecord` con estado `in_progress` (campo `status`
   nuevo: `in_progress` | `completed`) dentro de su propia transacción.
   La unique constraint `(user, key)` decide quién ejecuta.
2. Ganador: ejecuta la vista, actualiza el registro a `completed` con la
   respuesta. Si la vista lanza o devuelve no-2xx, **borra** la reserva (los
   errores no se cachean, igual que hoy).
3. Perdedor (IntegrityError en el INSERT): relee el registro. Si `completed`,
   devuelve la respuesta cacheada; si `in_progress`, devuelve **409** con
   `Retry-After: 1` — el cliente offline ya reintenta con backoff (409 se
   añadirá a `RETRYABLE_STATUSES` del sync worker).

Consideración: si el proceso muere entre reserva y completado, la clave queda
`in_progress` huérfana. La tarea de limpieza diaria (`cleanup_idempotency_records`)
purgará `in_progress` con más de N minutos; el reintento del cliente tras esa
purga ejecuta la mutación de nuevo — mismo comportamiento que hoy, sin regresión.

### Oleada E — Capa de servicios en routines (A3, A6, A7)

`apps/routines/services.py` con las tres transacciones de dominio:

- `log_routine(routine, user, *, notes, client_created_at, lot_selections)` —
  cuerpo actual de `RoutineViewSet.log` (entry + consumo + reset de
  NotificationState).
- `consume_stock(stock, user, *, quantity, lot_selections, client_created_at)` —
  cuerpo de `StockViewSet.consume`.
- `undo_entry(entry)` — restauración de lotes de `RoutineEntryViewSet.destroy`,
  respetando el invariante no-merge de seriales (T023).

Las vistas quedan en: validar entrada (serializers de la oleada B) → llamar al
servicio → serializar respuesta. Además:

- `check_precondition(request, instance, field)` extraída a `core/mixins.py` y
  reutilizada por `OptimisticLockingMixin` y `users.views.me` (A6).
- `routines_for_user(user, *, active_only=False)` en un módulo de queries,
  única fuente del queryset + prefetch budget para `RoutineViewSet` y
  `dashboard` (A7).

Regla de oro de la oleada: **cero cambios de comportamiento observable** — la
suite existente debe pasar sin editar asserts (solo imports/paths si acaso).

### Oleada F — Métricas de stock como módulo de dominio (A2)

`apps/routines/stock_metrics.py` con funciones puras:

- `partition_quantities(lots, *, today, warning_days)` → dataclass
  `QuantityPartition(available, soon, healthy, expired)`.
- `consumption_rates(routines, consumptions, owner_id, *, settings)` →
  `ConsumptionEstimate(own, shared, depletion_date, is_estimated)`.
- `stock_severity(partition, estimate, *, settings)` / `expiry_severity(lots)`.

`StockSerializer` pasa a ser un mapeo fino sobre estas funciones;
`Stock.quantity_available` delega en `partition_quantities` — la regla
"cantidad disponible" queda con **una** implementación. Los tests de reglas
de negocio migran a tests unitarios puros (sin DRF ni DB) manteniendo un test
de humo por campo en el serializer.

### Oleada G — Async push, tests troceados, N+1 (A5, Q2, Q3)

- `send_push_notification` se envuelve en tarea Celery
  (`apps/notifications/tasks.send_push_task`); los `notify_*` llamados desde
  vistas (`notify_stock_shared`, `notify_routine_shared`, `notify_contact_added`)
  despachan con `.delay()`. En tests siguen siendo síncronos
  (`CELERY_TASK_ALWAYS_EAGER` ya activo).
- `tests.py` monolíticos → paquete `tests/` por app (mecánico, sin tocar
  cuerpos de tests): `routines` (4.634 líneas) primero, después `notifications`
  y `users`.
- `contact_delete`: sustituir los 4 bucles por operaciones sobre la tabla
  through (`Routine.shared_with.through.objects.filter(...).delete()` en ambas
  direcciones). Documentar en `dashboard` el límite de diseño (sin paginación,
  pensado para uso doméstico).

### Oleada H — Descomposición de páginas-dios (Q1)

Mismo patrón que el refactor de StockDetail (#75, plan
`stock-frontend-refactor.md`):

1. `SettingsPage` (663 líneas) → secciones `ProfileSection`,
   `LanguageSection`, `PushSection`, `QuietHoursSection`, `ContactsSection`,
   cada una con su estado y mutaciones; la página queda como composición.
2. `RoutineFormPage` (637) → hook `useRoutineForm` (estado + validación) +
   subcomponentes de secciones del formulario.
3. `RoutineDetailPage` (547) y `StockFormPage` (458) — mismo patrón, menor
   prioridad.

Criterio de aceptación estructural (no de líneas): **nada de estado de
formulario en el componente de página**; cada sección testeable de forma
aislada. Se espera que la cobertura de ramas suba sola al partir los
condicionales.

### Oleada I — E2E en CI y cadena de suministro (T1, S6)

- Job de CI `test-e2e`: levanta el compose de dev + build de `nudge-e2e`,
  ejecuta `--project=chromium-preview` (18 specs, históricamente estables).
  Activado en PRs a `main`; los specs `chromium-dev` con flakiness conocida
  quedan fuera del gate hasta resolver su causa raíz.
- Backend: `requirements.in` (los rangos `~=` actuales) + `requirements.lock`
  generado con `pip-compile --generate-hashes`; el Dockerfile y CI instalan
  del lock.
- Job de auditoría: `pip-audit` + `npm audit --omit=dev` (informativo primero,
  gate cuando esté limpio dos semanas).
- `dependabot.yml` para GitHub Actions y las dos raíces de paquetes (npm, pip),
  con agrupación mensual para no generar ruido.

### Oleada J — Refresh token en cookie httpOnly (S1-fase 2, A4)

La más invasiva; va la última con el resto del terreno ya estabilizado.

**Precondición verificada**: la API es mismo origen en todos los entornos
(dev: proxy Vite `/api → backend:8000`; prod: nginx `/api → backend`). No hay
CORS con credenciales que configurar. Atención: `VITE_API_BASE_URL` permite
apuntar a un origen absoluto — la migración lo deprecia a favor de rutas
relativas (`/api`) y lo documenta en `upgrade.md`.

**Diseño**:

- `login_verify` y `auth/refresh/` pasan a responder el refresh token en
  cookie `httpOnly; Secure; SameSite=Strict; Path=/api/auth/` (scope mínimo:
  solo viaja a los endpoints de auth). El body deja de incluir `refresh`.
- El access token (2 h) vive **solo en memoria** (módulo `api/client.js`),
  nunca en `localStorage`. Al arrancar la app: intento de refresh silencioso
  vía cookie → access nuevo; si falla u offline, la UI usa el snapshot
  persistido de TanStack Query (comportamiento offline actual intacto — las
  llamadas de red fallarían igualmente sin conexión).
- CSRF: un endpoint de refresh basado en cookie es invocable cross-site. Con
  `SameSite=Strict` el navegador ya no adjunta la cookie en peticiones
  cross-site, y el endpoint solo emite un access token en el body (nunca
  ejecuta acciones). Se añade además la comprobación de cabecera
  `Origin`/`Referer` contra `CSRF_TRUSTED_ORIGINS` como segunda capa.
- `logout` (oleada C) pasa a leer el refresh de la cookie y a expirarla.
- Compatibilidad: durante una versión, `auth/refresh/` acepta el token por
  body **o** cookie (los PWA instalados con sesión en localStorage migran en
  su primer refresh: el servidor responde con cookie y el cliente borra el
  localStorage). Después se retira el camino por body.
- Impacto en E2E: `helpers/session.js` hace login por UI, así que sigue
  funcionando; los specs que manipulan `localStorage` de tokens directamente
  se actualizan.

**A4 (signals)**: con la capa de servicios de la oleada E asentada,
`delete_empty_lot` y `unlink_routines_on_unshare` se convierten en llamadas
explícitas desde los servicios (`consume_stock`, `undo_entry`, unshare) y los
signals se eliminan, junto con el skip "defensivo" de lotes a 0 del serializer.

## Scope

### What is included

- Los 20 hallazgos de `docs/technical-review.md`, agrupados en las oleadas A–J.
- Adaptación frontend completa del nuevo contrato de error de consumo (C1).
- Migración completa de S1: logout con revocación **y** cookie httpOnly.
- Cierre documental de C4/S5 con tests que congelan la matriz de permisos.

### What is NOT included

- Cambios de la matriz de permisos de sharing (solo se documenta y congela la
  actual; cambiarla sería una feature nueva).
- Paginación del dashboard u optimizaciones de escala (Q3 solo documenta el
  límite de diseño).
- Rediseños de UX. La descomposición de páginas (oleada H) es estructural,
  sin cambio visual.
- Rotación de secretos ya existentes (los `.pem` locales nunca llegaron a git;
  no hay incidente que remediar).

## Affected layers

| Layer | Impact |
|-------|--------|
| Backend (Django/DRF) | Alto: excepciones de dominio, serializers de entrada, services.py, stock_metrics.py, middleware de idempotencia, endpoints de auth (logout, refresh con cookie), throttles, gate del seed |
| Frontend (React/Vite) | Alto: manejo del 422 de consumo, logout, access token en memoria, refresh por cookie, descomposición de SettingsPage/RoutineFormPage |
| Celery/Redis | Bajo: nueva tarea `send_push_task`; sin cambios de broker |
| Infrastructure (Docker) | Medio: cabeceras nginx, requirements.lock en Dockerfile, jobs de CI (e2e, auditoría), dependabot |
| Database (PostgreSQL) | Bajo: migración para `IdempotencyRecord.status` y el contador de fallos de login; sin migración de datos |

## Implementation order

Cada paso = una invocación de `/dev-2-tasks` sobre la sección correspondiente.

1. **Oleada A** — cabeceras nginx + higiene de ficheros (sin dependencias).
2. **Oleada B** — excepciones de dominio + invariante de consumo, backend y
   frontend juntos (desbloquea E, que moverá este código a servicios).
3. **Oleada C** — logout con revocación, gate del seed, throttles, doc de
   permisos/privacidad con tests.
4. **Oleada D** — idempotencia reserva-primero (independiente; puede
   intercambiarse con C).
5. **Oleada E** — services.py + deduplicación de optimistic locking + queryset
   compartido (requiere B asentada).
6. **Oleada F** — stock_metrics.py (independiente de E, después para no tocar
   los mismos ficheros a la vez).
7. **Oleada G** — push async, troceo de tests, N+1.
8. **Oleada H** — descomposición de páginas frontend.
9. **Oleada I** — E2E en CI + lockfile/auditoría de dependencias (antes de J
   a propósito: J necesita la red E2E en CI como red de seguridad).
10. **Oleada J** — cookie httpOnly + retirada de signals.

## Critical files

| File | Changes |
|------|---------|
| `frontend/nginx.conf` | Cabeceras de seguridad + CSP (A) |
| `.gitignore` | `*.pem`, `celerybeat-schedule` (A) |
| `backend/apps/routines/models.py` | Quitar import DRF; invariante en `consume_lots`; retirar signals (B, J) |
| `backend/apps/routines/exceptions.py` | Nuevo: excepciones de dominio (B) |
| `backend/apps/routines/serializers.py` | `ConsumeInputSerializer`; adelgazamiento hacia stock_metrics (B, F) |
| `backend/apps/routines/services.py` | Nuevo: log_routine, consume_stock, undo_entry (E) |
| `backend/apps/routines/stock_metrics.py` | Nuevo: partición, tasas, severidad (F) |
| `backend/apps/routines/views.py` | Vistas adelgazadas; queryset compartido (B, E) |
| `backend/apps/idempotency/middleware.py` + models | Reserva-primero con `status` (D) |
| `backend/apps/users/views.py` | logout, throttles, contador de fallos, cookie en refresh (C, J) |
| `backend/apps/core/views.py` + `core/urls.py` | Gate del seed por registro condicional (C) |
| `backend/apps/core/mixins.py` | `check_precondition` compartida (E) |
| `frontend/src/api/client.js` | Access token en memoria; refresh por cookie (J) |
| `frontend/src/contexts/AuthContext.jsx` | logout con revocación; sin localStorage (C, J) |
| `frontend/src/hooks/mutations/useConsumeStock.js`, `useLogRoutine.js` | Manejo 422 insufficient_stock (B) |
| `frontend/src/offline/sync.js` | 409 retryable; label del error 422 (B, D) |
| `frontend/src/pages/SettingsPage.jsx`, `RoutineFormPage.jsx` | Descomposición en secciones/hooks (H) |
| `.github/workflows/ci.yml` | Jobs e2e + auditoría; instalación desde lock (I) |
| `backend/requirements.in` / `requirements.lock` | Nuevo esquema de pinning (I) |
| `docs/permissions-and-privacy.md` | Nuevo: matriz de permisos + postura de privacidad (C) |

## Risks and considerations

- **CSP (A)**: si el build emite algo inline (vite-plugin-pwa, registro del
  SW), la CSP estricta rompe la app entera. Mitigación: verificación con la
  suite E2E completa contra la imagen de producción antes de merge; hashes de
  script como plan B.
- **C1 endurece un contrato (B)**: consumos que hoy "funcionan" (parcialmente,
  con auditoría falsa) pasarán a fallar con 422. Es el comportamiento correcto,
  pero clientes offline con mutaciones encoladas de la versión anterior pueden
  recibir el error al sincronizar — la entrada cae a `error` en PendingBadge y
  es descartable con rollback, que es la degradación aceptable.
- **Idempotencia (D)**: el estado `in_progress` introduce un caso nuevo (409 +
  reintento). Los clientes antiguos sin manejo de 409 tratarían la entrada como
  `error` no reintentable — desplegar frontend (409 retryable) **antes** que
  backend, o en la misma release.
- **Oleada E es un refactor puro**: el riesgo es de regresión silenciosa en
  side effects (notificaciones, NotificationState). Guardarraíl: la suite
  existente debe pasar **sin editar asserts**.
- **Cookie httpOnly (J)**: interacción con PWA instalada, SW y cola offline.
  Riesgos concretos: sesiones existentes (mitigado con el periodo de doble
  aceptación body/cookie), `Path=/api/auth/` mal calculado si el despliegue
  usa un prefijo distinto, y specs E2E que toquen localStorage. Es la razón de
  que J vaya después de I (E2E en CI).
- **Orden de despliegue**: B, D y J tienen acoplamiento frontend↔backend.
  Regla general del plan: los cambios de cliente tolerantes (aceptar el
  formato nuevo Y el viejo) se despliegan antes que el cambio de servidor.
- Riesgo de conflicto con trabajo en vuelo: la rama actual
  (`feat/manual-serial-and-faster-lot-entry`) toca `AddLotForm` y lotes; la
  oleada B toca `consume_lots`. Merge de la rama en curso antes de arrancar B.

## Open design decisions

Ninguna bloqueante. Dos decisiones de detalle se delegan a la tarea que las
implemente, con la recomendación ya escrita:

1. **Mecanismo del contador de fallos de login por cuenta (C)**: campo en
   `User` vs modelo dedicado. Recomendación: modelo pequeño con ventana
   temporal, simétrico a `LoginCode`.
2. **TTL de purga de reservas `in_progress` huérfanas (D)**: recomendación
   15 minutos (muy por encima del timeout de gunicorn, muy por debajo de la
   ventana de retención de 24 h actual).
