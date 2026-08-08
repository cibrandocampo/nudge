# Nudge — Revisión técnica del proyecto

> Análisis realizado el 2026-08-09 sobre la rama `feat/manual-serial-and-faster-lot-entry`
> (último commit `58c033c`). Objetivo: identificar problemas de arquitectura,
> implementación y seguridad para afrontarlos de forma incremental. Cada hallazgo
> tiene un identificador estable para poder referenciarlo desde tareas futuras.

## Cómo leer este documento

- **Severidad**: 🔴 alta (afecta a seguridad o integridad de datos), 🟠 media
  (deuda estructural que crece con el proyecto), 🟡 baja (pulido / consistencia).
- **Esfuerzo**: S (< medio día), M (1–2 días), L (varios días / requiere diseño).
- Las referencias `fichero:línea` corresponden al commit analizado.

---

## Fortalezas (lo que ya está a nivel de escaparate)

Antes de los problemas, lo que un revisor externo destacaría en positivo — merece
mantenerse intacto en cualquier refactor:

- **Offline-first completo y coherente de extremo a extremo**: cola de mutaciones
  en IndexedDB con backoff exponencial (`frontend/src/offline/`), claves de
  idempotencia generadas en cliente y deduplicadas en servidor
  (`apps/idempotency/`), bloqueo optimista con `If-Unmodified-Since`/412 y modal
  de conflicto. Pocas apps personales llegan a este nivel.
- **Flujo OTP bien ejecutado**: código hasheado (SHA-256, nunca en claro), TTL de
  10 min, límite de 5 intentos, throttling en tres ejes (IP/minuto, IP/hora,
  email destino/hora).
- **Contenedores de producción endurecidos**: `read_only`, `no-new-privileges`,
  usuario no root en la imagen, `tmpfs`, límites de memoria, healthchecks.
- **Disciplina de calidad**: cobertura ≥95 % con gate en CI en ambos stacks,
  guardas creativas (`cssModuleReferences.test.js`), lint + format en CI,
  comentarios que explican el *porqué* y no el *qué*.
- **Documentación de decisiones**: planes en `docs/plans/`, comentarios con
  referencias a tareas (T023, T164…), memoria de flaky tests diagnosticados
  hasta la causa raíz.

---

## 1. Seguridad

### S1 · 🔴 · M — Tokens JWT en `localStorage` con refresh de 60 días

`frontend/src/api/client.js:16,137-138` y `AuthContext.jsx:105-106` guardan
`access_token` y `refresh_token` en `localStorage`. Cualquier XSS (incluida una
dependencia npm comprometida — la app carga ~30 paquetes de runtime) puede
exfiltrar un refresh token válido durante **60 días**
(`SIMPLE_JWT.REFRESH_TOKEN_LIFETIME`, `backend/nudge/settings.py:201`).

Agravante: `logout()` (`AuthContext.jsx:121-129`) solo borra el `localStorage`;
el refresh token sigue siendo válido en el servidor. La app `token_blacklist`
está instalada pero solo se usa en la rotación, no hay endpoint de logout que
revoque.

**Sugerencia (por fases):**
1. Añadir endpoint `POST /api/auth/logout/` que blacklistee el refresh token, y
   llamarlo desde `logout()`. (S)
2. Mover el refresh token a cookie `httpOnly` + `SameSite=Strict` + `Secure`
   (el access puede seguir en memoria — no en localStorage). Requiere ajustar el
   flujo de refresh y CORS con `credentials`. (M/L)

### S2 · 🔴 · S — La SPA se sirve sin cabeceras de seguridad

`frontend/nginx.conf` no añade ninguna cabecera de seguridad: ni
`Content-Security-Policy`, ni `X-Content-Type-Options`, ni `Referrer-Policy`,
ni `X-Frame-Options` para `index.html`. Django las emite solo para sus propias
respuestas (`/api/`, `/admin/`); el HTML de la aplicación — justo donde un XSS
haría daño (ver S1) — queda sin protección. Para una PWA con service worker una
CSP estricta es la mitigación de mayor retorno.

**Sugerencia:** bloque `add_header` en el `location /` de nginx con una CSP
(`default-src 'self'`; afinar `connect-src` para la API y los endpoints push),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
y `X-Frame-Options: DENY`. Verificar que Vite no requiera `unsafe-inline`
(los estilos van en ficheros, debería ser viable).

### S3 · 🟠 · S — `SeedView` accesible sin autenticación bajo una env var

`backend/apps/core/views.py:45-52`: `POST /api/internal/seed/` con `AllowAny`,
protegido solo por `DEBUG or E2E_SEED_ALLOWED=true`. Si esa variable se filtra a
un `.env` de producción (copy-paste del de e2e), cualquiera puede **destruir y
resembrar la base de datos** sin credenciales.

**Sugerencia:** exigir además un secreto compartido (header con token) o
directamente eliminar la ruta cuando `DEBUG=False`, registrándola
condicionalmente en `urls.py`. Como red extra, que el comando `seed` se niegue a
correr si detecta usuarios reales (> N usuarios no-demo).

### S4 · 🟠 · S — Endpoints de contraseña sin protección de fuerza bruta por cuenta

- `change_password` (`backend/apps/users/views.py:145-157`) no tiene throttle:
  una sesión robada puede probar la contraseña actual sin límite.
- `login_verify` para usuarios `password` solo tiene throttle por IP (10/min);
  no hay lockout por cuenta como sí lo hay para OTP (`attempts >= 5`).

**Sugerencia:** añadir un `UserRateThrottle` a `change_password` y un contador
de fallos por usuario (o reutilizar el patrón `LoginCode.attempts`) en el camino
password de `login_verify`.

### S5 · 🟡 · S — Enumeración de emails registrados

- `login_start` devuelve `404 user_not_found` cuando el email no existe
  (decisión consciente con self-signup desactivado, pero conviene documentarla
  como trade-off UX vs privacidad).
- `POST /api/auth/contacts/` (`users/views.py:204-212`) distingue
  "User not found" / "Already a contact" / éxito: cualquier usuario autenticado
  puede comprobar si un email tiene cuenta.

**Sugerencia:** para contactos, valorar respuesta uniforme ("invitación enviada
si existe") o al menos dejar constancia escrita de que se acepta el riesgo en
una instancia familiar/pequeña.

### S6 · 🟠 · M — Cadena de suministro: sin lockfile en backend ni escaneo automático

- `backend/requirements.txt` usa rangos `~=` sin lockfile ni hashes: dos builds
  de la misma revisión pueden llevar dependencias distintas, y un release
  malicioso de un paquete entra solo.
- No hay `dependabot.yml`/Renovate ni escaneo (`pip-audit`, `npm audit`,
  `trivy`) en CI. `weekly-rebuild.yml` mitiga parcialmente refrescando imágenes.

**Sugerencia:** compilar un `requirements.lock` con `pip-compile
--generate-hashes` (los `~=` quedan como fuente en un `requirements.in`), y
añadir un job de CI con `pip-audit` + `npm audit --omit=dev` (este último ya
está a 0 según memoria del proyecto).

### S7 · 🟡 · S — Higiene de secretos locales

`backend/private_key.pem` y `public_key.pem` (VAPID) viven sueltos en el árbol
de trabajo. **No están en git**, pero nada impide un `git add .` desafortunado.

**Sugerencia:** añadir `*.pem` a `.gitignore` y mover la generación a
`docs/` como instrucción (`manage.py generate_vapid_keys`), no como ficheros
persistentes en el repo.

---

## 2. Arquitectura y separación de capas

El backend sigue el estilo "fat models" de Django más que DDD estricto — es una
elección válida, pero hay tres sitios donde las capas se cruzan de verdad:

### A1 · 🟠 · S — El dominio importa la capa de presentación

`backend/apps/routines/models.py:11` importa `rest_framework.serializers` y
`Stock.consume_lots` lanza `serializers.ValidationError` (líneas 144, 149). El
modelo de dominio conoce el framework HTTP: no se puede reutilizar
`consume_lots` desde un comando de management o una tarea Celery sin arrastrar
semántica DRF, y es la señal de acoplamiento más visible para cualquier revisor.

**Sugerencia:** definir excepciones de dominio (`InsufficientStock`,
`InvalidLotSelection`) en `apps/routines/exceptions.py` y traducirlas a 400/422
en un `exception_handler` de DRF o en la vista. Cambio pequeño, mensaje grande.

### A2 · 🟠 · L — Lógica de negocio pesada en serializers, duplicada con el modelo

`StockSerializer` (`serializers.py:117-506`) contiene el cálculo de severidad,
la estimación de agotamiento y las tasas de consumo diario — ~250 líneas de
reglas de negocio en la capa de serialización. Además la regla
"cantidad disponible" existe **dos veces** con implementaciones paralelas:
`Stock.quantity_available` (modelo, `models.py:96-114`) y
`StockSerializer._quantity_partition` (serializer, `serializers.py:267-306`).
Hoy coinciden; nada obliga a que sigan haciéndolo.

**Sugerencia:** extraer un módulo de dominio (p. ej.
`apps/routines/stock_metrics.py`) con funciones puras que reciban lotes y
consumos y devuelvan el dataclass de métricas (partición, severidad, agotamiento).
Modelo y serializer consumen la misma fuente; los tests de reglas de negocio
dejan de necesitar el aparato de DRF.

### A3 · 🟠 · M — Orquestación de dominio dentro de los viewsets

`RoutineViewSet.log` (`views.py:275-332`), `StockViewSet.consume`
(`views.py:136-172`) y sobre todo `RoutineEntryViewSet.destroy` con su
restauración de lotes (`views.py:406-468`, ~60 líneas de reglas de inventario)
son transacciones de dominio escritas dentro de métodos HTTP. La app `users` sí
tiene `services.py`; `routines` — la app con más lógica — no. Es la
inconsistencia estructural más clara del backend.

**Sugerencia:** crear `apps/routines/services.py` con
`log_routine(routine, user, ...)`, `consume_stock(stock, user, ...)`,
`undo_entry(entry)`. Las vistas quedan en parseo de entrada + llamada + respuesta.
Hacerlo módulo a módulo, empezando por `undo_entry` (la más larga y la más pura).

### A4 · 🟡 · M — Side effects vía signals

`delete_empty_lot` (post_save que borra lotes a 0, `models.py:272-275`) y
`unlink_routines_on_unshare` (`models.py:278-286`) esconden mutaciones
importantes en flujo implícito. El propio código ya paga el precio: el
serializer salta lotes a 0 "defensivamente" porque "bulk paths can leave
stragglers" (`serializers.py:272-273`).

**Sugerencia:** cuando exista la capa de servicios (A3), mover estos efectos a
llamadas explícitas y eliminar los signals. Mientras tanto, dejarlos — dos
mecanismos a la vez sería peor.

### A5 · 🟠 · S — Notificaciones push síncronas en el ciclo de request

`StockViewSet.update` / `RoutineViewSet.update` llaman a `notify_*`
(`views.py:94-97, 264-267`), que ejecuta `webpush()` — peticiones HTTP a los
servidores de push de Google/Mozilla/Apple — **en línea**
(`apps/notifications/push.py:128-168`), una por dispositivo suscrito. Un
endpoint push lento añade segundos a un PATCH de compartir, y un fallo de red
del lado push puede convertirse en 500 del API. Existe Celery y ya se usa para
los recordatorios: la asimetría es un descuido, no una decisión.

**Sugerencia:** convertir `notify_stock_shared` / `notify_routine_shared` /
`notify_contact_added` en tareas `.delay()` (o envolver `send_push_notification`
en una tarea genérica).

### A6 · 🟡 · S — Bloqueo optimista reimplementado a mano en `me`

`users/views.py:167-186` duplica la lógica de `OptimisticLockingMixin`
(parseo del header, comparación truncada a segundo, payload 412) porque `me` es
una función y no un ViewSet. Dos implementaciones de un protocolo delicado
acaban divergiendo.

**Sugerencia:** extraer la comprobación a una función
`check_precondition(request, instance, field)` en `core/mixins.py` que usen
tanto el mixin como `me`.

### A7 · 🟡 · S — `dashboard()` duplica el queryset del viewset

`views.py:471-511` reconoce en comentario que "mirrors RoutineViewSet.get_queryset's
prefetch budget". Si el presupuesto de prefetch cambia en uno y no en otro,
vuelven las N+1 silenciosas.

**Sugerencia:** función compartida `routines_for_user(user, active_only=False)`
que construya el queryset con sus prefetches en un único sitio.

---

## 3. Integridad de datos y concurrencia

### C1 · 🔴 · M — `consume_lots` no garantiza que lo consumido = lo solicitado

`models.py:116-174`:

- **Camino FEFO**: si los lotes se agotan antes de cubrir `quantity`, el bucle
  termina sin error. Se crea un `StockConsumption` con `quantity = solicitado`
  pero `consumed_lots` sumando menos — **el registro de auditoría miente**.
- **Camino explícito**: `consume_qty = min(lot.quantity, qty)` (línea 155)
  recorta en silencio si el lote tiene menos unidades de las pedidas; la
  validación previa solo comprueba que la *suma solicitada* cuadre, no que sea
  *consumible*.
- El pre-check de `log()` (`views.py:296`) lee `stock.quantity` **fuera** de
  cualquier lock: dos logs concurrentes pueden pasar el check y uno de los dos
  consume menos de lo que registra (TOCTOU). Las cantidades nunca se vuelven
  negativas (gracias al `min()` y al `CheckConstraint`), pero la auditoría sí
  queda inconsistente.

**Sugerencia:** al final de `consume_lots`, si
`sum(consumed) != quantity`, lanzar `InsufficientStock` (ver A1) y dejar que la
transacción haga rollback. Eso convierte el TOCTOU del pre-check en un 422
tardío pero correcto, y hace el pre-check una mera optimización de UX.

### C2 · 🔴 · M — El middleware de idempotencia tiene una ventana de carrera

`apps/idempotency/middleware.py:63-85`: patrón *get → ejecutar vista → create*.
Dos peticiones concurrentes con la misma `Idempotency-Key` (doble click +
reintento de red) pasan ambas el `DoesNotExist` y **ejecutan la vista dos
veces** — doble decremento de stock, doble entrada de rutina. El
`IntegrityError` capturado en `_store` solo dedupe el *registro*, no la
*ejecución* (el comentario "the response is idempotent by construction" es
incorrecto para vistas con side effects).

**Sugerencia:** invertir el orden — `create` primero con estado `in_progress`
(la unique constraint `(user, key)` decide quién ejecuta); el perdedor espera o
devuelve 409/`Retry-After`. Alternativa más simple:
`select_for_update` sobre una fila creada al inicio dentro de una transacción.

### C3 · 🟡 · S — `lot_selections` admite `lot_id` duplicados y se valida a mano

- La validación de ids usa `set` (`models.py:145-149`), así que
  `[{lot_id: 5, quantity: 1}, {lot_id: 5, quantity: 1}]` pasa y consume dos
  veces del mismo lote. Probablemente inocuo, pero no está decidido ni testeado.
- La estructura de `lot_selections` y `quantity` se valida a mano y repartida
  entre la vista (`int(request.data.get(...))`, `views.py:143-148`) y el modelo,
  en lugar de un serializer de entrada como ya hace `ClientTimestampInputSerializer`.

**Sugerencia:** un `ConsumeInputSerializer` (quantity + lot_selections con
validación de duplicados) usado por `consume` y `log`.

### C4 · 🟡 · S — Matriz de permisos de sharing con asimetrías no documentadas

- **Lotes**: crear exige ser owner (`_get_stock_for_create`, `views.py:186-191`)
  pero editar/borrar lo permite cualquier usuario compartido (el queryset de
  `StockLotViewSet` incluye `shared_with` y no se aplica `IsOwner`).
- **Entradas de rutina**: `destroy` es owner-only (explícito, `views.py:430-434`)
  pero `PATCH` (editar `notes`) lo puede hacer cualquier usuario compartido.

Puede que ambas sean intencionales (consumo colaborativo), pero la asimetría no
está escrita en ningún sitio y los tests no la fijan.

**Sugerencia:** documentar la matriz de permisos (owner vs shared por recurso y
verbo) en `docs/` y añadir los tests que la congelen.

---

## 4. Calidad de código

### Q1 · 🟠 · L — Páginas-dios en el frontend

`SettingsPage.jsx` (663 líneas), `RoutineFormPage.jsx` (637),
`RoutineDetailPage.jsx` (547), `StockFormPage.jsx` (458) concentran estado de
formulario, orquestación de mutaciones y presentación. No es casual que el gap
de cobertura de ramas viva exactamente ahí (SettingsPage ~16 ramas sin cubrir,
RoutineFormPage ~15). El propio proyecto ya demostró el patrón correcto al
trocear StockDetail (#75) — falta aplicarlo al resto.

**Sugerencia (orden de ataque):** SettingsPage primero — se descompone
naturalmente en secciones independientes (Perfil, Idioma, Notificaciones/push,
Horas de silencio, Contactos), cada una con su hook. Después RoutineFormPage
(extraer el estado del formulario a un hook `useRoutineForm`).

### Q2 · 🟡 · M — Ficheros de test monolíticos en backend

`apps/routines/tests.py` tiene **4.634 líneas**; `notifications` 1.662,
`users` 1.640. Encontrar el test de una regla concreta es arqueología.

**Sugerencia:** convertir a paquete `tests/` por app
(`test_models.py`, `test_stock_views.py`, `test_routine_views.py`,
`test_serializers.py`…). Mecánico, sin riesgo, gran mejora de navegabilidad.

### Q3 · 🟡 · S — Consultas N+1 y endpoints sin límite

- `contact_delete` (`users/views.py:228-235`): cuatro bucles con una query de
  M2M por iteración. Con pocos contactos es irrelevante; como patrón, malo.
- `dashboard` serializa **todas** las rutinas del usuario sin paginación, con
  `is_due()` en Python por rutina. Correcto a escala doméstica; conviene dejar
  escrito el límite de diseño (p. ej. "pensado para < 200 rutinas/usuario").

### Q4 · 🟡 · S — Residuos en el árbol de trabajo

- `frontend/e2e/` (no trackeado) duplica confusamente el `e2e/` raíz real.
- `backend/celerybeat-schedule` es un artefacto de ejecución local.
- Los `.pem` de S7.

**Sugerencia:** borrar los residuos y añadir `celerybeat-schedule`, `*.pem` a
`.gitignore` para que no reaparezcan.

---

## 5. Testing e infraestructura

### T1 · 🟠 · M — La suite E2E no corre en CI

Existen 27 specs de Playwright maduros, pero `ci.yml` solo ejecuta unit tests.
La regresión T049→T052 (cambio de forma del formulario de lotes que rompió dos
specs en silencio) demostró exactamente el coste de esto.

**Sugerencia:** job de CI que levante el compose de dev + `nudge-e2e` en
`--project=chromium-preview` (los 18 specs del preview son fiables según la
memoria del proyecto; el flake residual conocido está en `chromium-dev`).
Aunque sea solo en PRs etiquetadas o nightly, el valor es alto.

### T2 · 🟡 · S — Sin tests de concurrencia para los invariantes de stock

C1–C2 son exactamente la clase de bug que los tests actuales (secuenciales) no
pueden ver. Tras arreglarlos, añadir tests con `threading` +
`transaction.on_commit` o al menos tests unitarios del nuevo error
`InsufficientStock` en ambos caminos de `consume_lots`.

### I1 · 🟡 · S — Un solo entorno de despliegue implícito

`deploy/naseira/` y los comentarios de settings ("Synology / nginx") atan la
configuración a una instalación concreta. Para enseñar el proyecto, un
`docs/deployment.md` genérico (reverse proxy TLS → compose) haría el mismo
trabajo sin exponer detalles del entorno personal.

---

## Roadmap sugerido

Orden pensado para maximizar señal con esfuerzo incremental; cada bloque es
independiente y compatible con el flujo `/fix` → `/push` o `/dev-1-plan`.

| Fase | Hallazgos | Tema | Esfuerzo |
|------|-----------|------|----------|
| 1 | S2, S7, Q4 | Cabeceras de seguridad en nginx + higiene de ficheros | S |
| 2 | C1, C3, A1 | Invariante de consumo + excepciones de dominio (van juntos) | M |
| 3 | S1 (fase 1), S3, S4 | Logout con revocación, gate del seed, throttles | S–M |
| 4 | C2 | Idempotencia sin carrera | M |
| 5 | A3, A6, A7 | `services.py` en routines + deduplicar optimistic locking | M |
| 6 | A2 | Extraer métricas de stock a módulo de dominio | L |
| 7 | A5, Q2, Q3 | Push async, trocear tests, N+1 | M |
| 8 | Q1 | Descomponer SettingsPage / RoutineFormPage | L |
| 9 | T1, S6 | E2E en CI + lockfile/auditoría de dependencias | M |
| 10 | S1 (fase 2), A4 | Refresh token en cookie httpOnly; retirar signals | L |

---

*Los hallazgos C4 y S5 no llevan fase: son decisiones a documentar más que
código a cambiar. Resolverlos por escrito (matriz de permisos, postura ante
enumeración de emails) ya cuenta como "hecho".*
