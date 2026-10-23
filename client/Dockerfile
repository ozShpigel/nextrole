# Bun from the committed bun.lock, as everywhere else in the client. This was
# `npm install`, which ignores bun.lock and resolved every dependency afresh
# on each build -- so a new release upstream could break a deploy with no
# change here (2026-10-23: npm's "Cannot read properties of null (reading
# 'edgesOut')" on an unchanged package.json). --frozen-lockfile fails the
# build if package.json and bun.lock disagree instead of quietly re-resolving.
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
COPY client/ .
# Vite inlines VITE_* env vars at build time. Setting any of these to a public
# service URL makes the browser call that service directly (CORS), bypassing
# the nginx reverse-proxy and the Cloudflare cold-start amplification that
# comes with a two-hop wake-up path. Leave any empty to keep its nginx fallback.
ARG VITE_SCRAPER_URL=""
ARG VITE_API_URL=""
ENV VITE_SCRAPER_URL=${VITE_SCRAPER_URL}
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
