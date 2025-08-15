# ---- Base ----
FROM node:20-alpine
WORKDIR /app

# Install deps separately for better caching
COPY package*.json ./
RUN npm ci

# Copy app
COPY . .

# Build if your package.json has "build" (no-op if not)
RUN npm run build || echo "no build script; skipping"

# Cloud Run expects port 8080
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start your server (ensure server.js uses process.env.PORT and 0.0.0.0)
CMD ["node", "server.js"]
