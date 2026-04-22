FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
# Vite inlines VITE_* env vars at build time. Setting this to the public
# JobDiscovery URL makes the browser call the service directly (CORS),
# bypassing the nginx reverse-proxy and the Cloudflare cold-start amplification
# that comes with a two-hop wake-up path. Leave empty to keep the nginx fallback.
ARG VITE_JOB_DISCOVERY_URL=""
ENV VITE_JOB_DISCOVERY_URL=${VITE_JOB_DISCOVERY_URL}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
