FROM node:20-alpine AS build
WORKDIR /app
COPY client/package.json client/bun.lock* ./
RUN npm install
COPY client/ .
# Vite inlines VITE_* env vars at build time. Setting any of these to a public
# service URL makes the browser call that service directly (CORS), bypassing
# the nginx reverse-proxy and the Cloudflare cold-start amplification that
# comes with a two-hop wake-up path. Leave any empty to keep its nginx fallback.
ARG VITE_SCRAPER_URL=""
ARG VITE_API_URL=""
ENV VITE_SCRAPER_URL=${VITE_SCRAPER_URL}
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
