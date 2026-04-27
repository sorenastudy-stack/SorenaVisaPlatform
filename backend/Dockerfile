FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY src ./src/
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
COPY start.sh ./start.sh
RUN chmod +x ./start.sh
CMD ["./start.sh"]
