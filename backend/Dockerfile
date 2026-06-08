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
# Runtime static assets — engagement-letter PDF + Caladea TTF that
# stampLiaIdentity() reads at every contract send, plus any other
# fixtures under assets/. Without this COPY the container starts
# cleanly but every contract send crashes with ENOENT at first request.
COPY assets ./assets/
COPY start.sh ./start.sh
RUN chmod +x ./start.sh
CMD ["./start.sh"]
