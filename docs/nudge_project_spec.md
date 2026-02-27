# Nudge

**Tagline:** A gentle reminder for recurring things.

Nudge es una aplicación para gestionar tareas recurrentes.\
El sistema vigila cuándo debe hacerse algo y envía un pequeño aviso
cuando llega el momento adecuado.

Está pensado para cualquier tipo de uso:

-   mantenimiento del hogar
-   cuidado de plantas
-   salud y medicación
-   reposición de consumibles
-   tareas periódicas

El objetivo es reducir olvidos sin generar ruido.

------------------------------------------------------------------------

# 1. Objetivos del proyecto

Crear un asistente ligero que:

-   recuerde tareas periódicas
-   registre cuándo se completan
-   gestione inventario opcional
-   envíe recordatorios útiles sin molestar

------------------------------------------------------------------------

# 2. Alcance (MVP)

El MVP incluirá:

-   creación de tareas recurrentes
-   intervalos configurables
-   notificaciones
-   registro de completado
-   inventario opcional
-   historial
-   web app instalable (PWA)
-   panel de administración

No incluido en esta fase:

-   analítica avanzada
-   multiusuario complejo
-   automatizaciones avanzadas
-   predicción inteligente

------------------------------------------------------------------------

# 3. Conceptos principales

## Routine

Algo que debe hacerse periódicamente.

Ejemplos:

-   Regar cactus
-   Cambiar filtro
-   Tomar medicación
-   Comprar café
-   Cambiar sensor

------------------------------------------------------------------------

## Completion

Registro de que la tarea se ha realizado.

Cada completion reinicia el ciclo.

------------------------------------------------------------------------

## Inventory (opcional)

Algunas tareas consumen algo.

Ejemplos:

-   filtros
-   sensores
-   baterías
-   cápsulas de café

El inventario es opcional pero importante para algunos usos.

------------------------------------------------------------------------

# 4. Requisitos funcionales

## RF1 --- Gestión de routines

El usuario puede:

-   Crear routine
-   Editar routine
-   Activar / desactivar routine

Campos:

-   nombre
-   descripción
-   intervalo
-   usa inventario (opcional)
-   consumo por ejecución

------------------------------------------------------------------------

## RF2 --- Intervalos

Las routines funcionan por intervalo desde la última completion.

Ejemplo:

Regar cactus\
Intervalo: 7 días

Última vez:

1 marzo

Siguiente:

8 marzo

Si se hace antes:

6 marzo

El ciclo se reinicia desde ese momento.

------------------------------------------------------------------------

## RF3 --- Notificación diaria

Cada día a las **08:30** el sistema evaluará:

Qué routines vencen hoy.

Si existen:

Enviar notificación.

Si no:

No enviar nada.

------------------------------------------------------------------------

## RF4 --- Notificación de vencimiento

Cuando el intervalo se cumple:

Enviar aviso.

------------------------------------------------------------------------

## RF5 --- Recordatorios periódicos

Si la tarea no se ha marcado como completada:

Recordar cada:

8 horas

Hasta completarla.

------------------------------------------------------------------------

## RF6 --- Registrar completion

El usuario puede pulsar:

Mark as done

Esto:

1.  crea completion
2.  actualiza inventario si aplica
3.  reinicia ciclo

------------------------------------------------------------------------

## RF7 --- Historial

Se guarda historial completo.

Ejemplo:

2026-03-10\
Filtro cambiado

2026-03-17\
Filtro cambiado antes

------------------------------------------------------------------------

## RF8 --- Dashboard

Pantalla principal muestra:

### Hoy

Tareas pendientes.

### Próximos

Tareas futuras.

Ejemplo:

Cactus → en 2 días\
Filtro → en 5 días\
Sensor → hoy

------------------------------------------------------------------------

## RF9 --- Inventario (opcional)

Algunas routines reducen inventario.

Ejemplo:

Filtros: 3\
Sensores: 2\
Café: 10

El inventario puede editarse manualmente.

En el MVP no habrá alertas automáticas de stock.

------------------------------------------------------------------------

## RF10 --- Administración

El panel de administración permitirá:

-   editar routines
-   editar inventario
-   ver historial
-   corregir datos

------------------------------------------------------------------------

# 5. Requisitos no funcionales

## Disponibilidad

El sistema puede estar apagado durante la noche (por ejemplo
02:00--08:00).

No es necesario recuperar notificaciones perdidas.

------------------------------------------------------------------------

## Precisión

Las notificaciones no necesitan ser exactas al minuto.

Un margen de varios minutos es aceptable.

------------------------------------------------------------------------

## Seguridad

Autenticación básica de usuario.

------------------------------------------------------------------------

## Escalabilidad

Inicialmente diseñado para uso personal, pero ampliable.

------------------------------------------------------------------------

# 6. Arquitectura

Backend

-   Django
-   Django Rest Framework

Base de datos

-   PostgreSQL

Worker

-   Celery

Broker

-   Redis

Frontend

-   PWA

------------------------------------------------------------------------

# Arquitectura general

PWA \| v API (Django) \| \|-- PostgreSQL \| \|-- Redis \| v Celery

------------------------------------------------------------------------

# 7. Modelo de datos

## Routine

id\
name\
description\
interval_hours\
uses_inventory\
inventory_usage\
is_active\
created_at\
updated_at

------------------------------------------------------------------------

## Completion

id\
routine_id\
created_at\
notes

------------------------------------------------------------------------

## Inventory

id\
routine_id\
quantity\
updated_at

------------------------------------------------------------------------

## NotificationState

routine_id\
last_due_notification\
last_reminder\
last_daily_notification

------------------------------------------------------------------------

# 8. Worker de notificaciones

Celery ejecutará cada 5 minutos.

Proceso:

-   calcular próxima ejecución
-   enviar avisos si corresponde
-   enviar recordatorios si sigue pendiente

------------------------------------------------------------------------

# 9. API (MVP)

## Routines

GET /routines\
POST /routines\
PATCH /routines/{id}

------------------------------------------------------------------------

## Completions

POST /routines/{id}/complete\
GET /completions

------------------------------------------------------------------------

## Inventory

GET /inventory\
POST /inventory/update

------------------------------------------------------------------------

# 10. Frontend

Aplicación PWA instalable.

Tecnologías sugeridas:

-   React
-   Next.js
-   Service Worker
-   Push API

------------------------------------------------------------------------

# Pantallas

Dashboard\
Routine detail\
Historial\
Inventario

------------------------------------------------------------------------

# 11. Tipos de notificación

Daily heads‑up\
Algo toca hoy.

Due\
Es momento de hacerlo.

Reminder\
Aún pendiente.

------------------------------------------------------------------------

# 12. Roadmap futuro

Fase 2:

-   alertas de inventario
-   widgets
-   estadísticas
-   compartir routines
-   multiusuario
-   integraciones

------------------------------------------------------------------------

# 13. Filosofía del producto

Nudge debe:

-   molestar lo mínimo
-   avisar lo justo
-   ser rápido
-   ser fiable
