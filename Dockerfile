FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=5600
# CLI migrations/worker use tsx; retain the locked tooling in the single deploy image.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 5600
CMD ["npm", "start"]
