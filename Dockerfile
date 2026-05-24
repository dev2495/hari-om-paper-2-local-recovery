FROM public.ecr.aws/docker/library/node:20-bookworm-slim

ENV APP_HOME=/app \
    PATH=/opt/hariom-venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BFF_INTERNAL_URL=http://127.0.0.1:14000 \
    NEXT_PUBLIC_BFF_URL=http://127.0.0.1:14000

WORKDIR ${APP_HOME}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        libpq-dev \
        postgresql \
        postgresql-contrib \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY hariom-erp/scripts/direct/requirements.all.txt /tmp/requirements.all.txt
COPY apps/bff-api/requirements.txt /tmp/bff-requirements.txt

RUN python3 -m venv /opt/hariom-venv \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.all.txt -r /tmp/bff-requirements.txt

COPY apps/web-ui/package.json apps/web-ui/package-lock.json ./apps/web-ui/
RUN cd apps/web-ui && npm ci --include=dev

COPY . .

RUN cd apps/web-ui && npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    APP_ENV=production \
    ENVIRONMENT=production \
    BFF_PORT=14000 \
    AUTH_PORT=18001 \
    MASTER_PORT=18002 \
    SPEC_PORT=18003 \
    PRODUCTION_PORT=18004 \
    INVENTORY_PORT=18005 \
    ANALYTICS_PORT=18007 \
    SALES_PORT=18008 \
    SEED_DEMO_USERS=false

EXPOSE 13000

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
    CMD sh -c 'curl -fsS "http://127.0.0.1:${WEB_UI_PORT:-${PORT:-13000}}/login" >/dev/null || exit 1'

CMD ["bash", "deploy/tinypod/start_single_container.sh"]
