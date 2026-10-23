# Digests are multi-platform official image indexes. Build explicitly linux/amd64.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS node
FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /opt/chert-pilot/railway-20260930-r1
COPY package.json package-lock.json cli.tgz ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY application/connector/handler.ts handler/handler.ts
RUN ./node_modules/.bin/tsc handler/handler.ts --outDir handler --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck --types node && npm prune --omit=dev --ignore-scripts --no-audit --no-fund
COPY runtime/requirements-amd64.lock ./requirements.lock
RUN python -m pip download --require-hashes --only-binary=:all: --no-deps -r requirements.lock -d /wheels && sha256sum /wheels/* > python-wheels.sha256 && python -m pip install --require-hashes --no-index --find-links=/wheels --no-deps --target=/python -r requirements.lock

FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS production
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=build /python /usr/local/lib/python3.12/site-packages
COPY --from=build /opt/chert-pilot/railway-20260930-r1 /opt/chert-pilot/railway-20260930-r1
WORKDIR /opt/chert-pilot/railway-20260930-r1
COPY application/receiver/src application/receiver/src
COPY application/connector/*.py application/connector/
COPY runtime/runtime.py runtime/node.mjs runtime/state.mjs runtime/
COPY inputs.json ./inputs.json
RUN groupadd --gid 10001 chert && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent chert && chmod -R a-w /opt/chert-pilot
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz', timeout=2).read()"]
ENTRYPOINT ["python", "/opt/chert-pilot/railway-20260930-r1/runtime/runtime.py"]
CMD ["run"]

# Isolated qualification image only. Never deploy this target.
FROM production AS qualification
USER root
COPY application/connector/tests application/connector/tests
COPY runtime/tests /qualification
COPY application/receiver/requirements-dev.lock /qualification/requirements-dev.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: --no-deps -r /qualification/requirements-dev.lock
USER 10001:10001
ENTRYPOINT ["python", "/qualification/entry.py"]
CMD ["run"]

# Default build is always the production image, without qualification substitutes.
FROM production AS runtime
