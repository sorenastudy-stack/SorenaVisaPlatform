FROM node:20-alpine

WORKDIR /app

# Copy all necessary files
COPY package*.json ./
COPY prisma ./prisma/
COPY .env* ./

# Install dependencies
RUN npm ci --only=production

# Copy built application code
COPY dist ./dist/

# Generate Prisma Client (required at runtime)
RUN npx prisma generate

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/public/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations and start the application
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
