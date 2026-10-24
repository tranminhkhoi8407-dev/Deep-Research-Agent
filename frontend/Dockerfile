FROM node:22-bookworm-slim AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=
ARG VITE_PRO_MONTHLY_PRICE=149000
ARG VITE_TEAM_MONTHLY_PRICE=499000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_PRO_MONTHLY_PRICE=${VITE_PRO_MONTHLY_PRICE} \
    VITE_TEAM_MONTHLY_PRICE=${VITE_TEAM_MONTHLY_PRICE}

RUN npm run build

FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/health"]
