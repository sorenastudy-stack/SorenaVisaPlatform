FROM node:20-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy prisma files
COPY prisma ./prisma/

# Copy start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Copy built application
COPY dist ./dist/

# Generate Prisma Client
RUN npx prisma generate

# Start the application (migrations will run in start.sh)
CMD ["./start.sh"]
