FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

USER node

EXPOSE 8090

CMD ["node", "src/server.ts"]
