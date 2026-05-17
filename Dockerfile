ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security

FROM ${NODE_IMAGE}

ARG APT_MIRROR
ARG APT_SECURITY_MIRROR

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CANVASFORGE_DATA_DIR=/app/data

WORKDIR /app

RUN sed -i \
    -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|http://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    python3 \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && mkdir -p /app/data

COPY . .

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "/app/docker/start-dev.sh"]
