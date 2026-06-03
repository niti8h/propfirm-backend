# Use Node 20 as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose backend port
EXPOSE 3001

# Start the server (will automatically run db push via script if configured, or just start server)
# Make sure to run migrations or db push on startup if needed, but standard start is usually best.
CMD ["npm", "start"]
