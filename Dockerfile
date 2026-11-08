# The UI is a build artefact: Vite compiles it once, and the runtime image
# keeps only the server (node built-ins, no dependencies) and the static bundle.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist

USER node

EXPOSE 8090

CMD ["node", "server/server.ts"]
