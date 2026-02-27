FROM python:3.12-slim

WORKDIR /app

# libpq-dev is needed at runtime by psycopg2-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN addgroup --gid 1001 --system appgroup && \
    adduser --uid 1001 --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "nudge.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2"]
