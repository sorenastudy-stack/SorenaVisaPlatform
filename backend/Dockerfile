FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy built code
COPY dist ./dist/

# Generate Prisma Client
RUN npx prisma generate

# Run migrations and start app
CMD npx prisma migrate deploy && node dist/main.js
