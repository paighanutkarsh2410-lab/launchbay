# The Launchbay API. Build from the repository root, since the API reads the golden-path
# templates and the guardrail policies next to it:
#
#   docker build -f services/api/Dockerfile -t launchbay-api .
#
# The public demo runs this image with LAUNCHBAY_PUBLIC_DEMO=true (see render.yaml).
FROM python:3.12-slim

# Apply Debian security fixes newer than the base image.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# Same layout as the repository, so the API's default paths work unchanged.
WORKDIR /srv/services/api
COPY services/api/pyproject.toml ./
COPY services/api/app ./app
RUN pip install .
COPY services/api/demo ./demo
COPY templates /srv/templates
COPY platform/kyverno/policies /srv/platform/kyverno/policies

# The database lives in /tmp: the demo reseeds itself from its snapshot on every start.
ENV LAUNCHBAY_DATABASE_URL=sqlite+aiosqlite:////tmp/launchbay.db
RUN useradd --uid 10001 --no-create-home appuser
USER 10001
EXPOSE 8000
# Hosts like Render set PORT; behind their proxy, trust X-Forwarded-For for the client address.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
