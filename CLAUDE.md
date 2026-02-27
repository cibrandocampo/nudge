# Nudge — instrucciones para Claude Code

## Entorno de desarrollo: SIEMPRE usar Docker

**NUNCA ejecutes código Python, Node o npm directamente en el host.**
Usa siempre el entorno Docker de desarrollo definido en `dev/docker-compose.yml`.
Este compose usa bind mounts, por lo que los cambios en archivos locales son visibles
de inmediato dentro del contenedor — no hace falta reconstruir la imagen.

### Comandos de referencia

| Tarea | Comando |
|---|---|
| **Tests backend** | `docker compose -f dev/docker-compose.yml exec backend python manage.py test` |
| **Tests con cobertura** | `docker compose -f dev/docker-compose.yml exec backend coverage run manage.py test` |
| **Tests e2e (Playwright)** | `cd e2e && E2E_USERNAME=admin E2E_PASSWORD=<pass> npx playwright test` |
| **Build frontend** | `docker compose -f dev/docker-compose.yml exec frontend npm run build` |
| **Instalar deps frontend** | `docker compose -f dev/docker-compose.yml exec frontend npm install` |
| **Django shell** | `docker compose -f dev/docker-compose.yml exec backend python manage.py shell` |
| **Makemigrations** | `docker compose -f dev/docker-compose.yml exec backend python manage.py makemigrations` |
| **Migrate** | `docker compose -f dev/docker-compose.yml exec backend python manage.py migrate` |

Si el entorno dev no está levantado, arrancarlo con:
```bash
docker compose -f dev/docker-compose.yml up -d
```

### Por qué NO usar `docker compose run --rm backend`
El `docker-compose.yml` raíz es el de **producción** — construye imágenes con `COPY` del
código. Los cambios locales no se reflejan hasta hacer `docker compose build`.
El `dev/docker-compose.yml` es el correcto para desarrollo.
