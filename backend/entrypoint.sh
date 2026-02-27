#!/bin/sh
set -e

# In development, generate a random secret key if none was provided.
# In production, require it explicitly (a random key would invalidate all
# JWT sessions on every container restart).
if [ -z "$DJANGO_SECRET_KEY" ]; then
    if [ "${DJANGO_DEBUG:-False}" = "True" ]; then
        export DJANGO_SECRET_KEY=$(python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")
        echo "==> DJANGO_SECRET_KEY not set — generated random key (dev only)."
    else
        echo "ERROR: DJANGO_SECRET_KEY is not set and is required in production."
        echo "==> Generate one with: python -c \"from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())\""
        exit 1
    fi
fi

# In production, require VAPID configuration for push notifications.
if [ "${DJANGO_DEBUG:-False}" != "True" ]; then
    _missing=0
    for _var in VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY; do
        eval _val="\$$_var"
        if [ -z "$_val" ]; then
            echo "ERROR: $_var is not set and is required in production."
            _missing=1
        fi
    done
    if [ "$_missing" -eq 1 ]; then
        echo "==> Aborting: set the missing environment variables and restart."
        exit 1
    fi
fi

# Run migrations for the web server (gunicorn = prod, runserver = dev)
if [ "${1#*gunicorn}" != "$1" ] || [ "${1#*runserver}" != "$1" ]; then
    echo "==> Applying migrations..."
    python manage.py migrate --noinput

    echo "==> Ensuring admin user exists..."
    python manage.py ensure_admin
fi

# Collect static files only for production (runserver serves them automatically)
if [ "${1#*gunicorn}" != "$1" ]; then
    echo "==> Collecting static files..."
    python manage.py collectstatic --noinput --clear
fi

exec "$@"
