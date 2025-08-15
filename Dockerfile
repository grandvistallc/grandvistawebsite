FROM node:20-alpine
WORKDIR /app

# Install deps separately for cache efficiency
COPY package*.json ./
RUN npm ci

# Copy the rest of the app
COPY . .

# Cloud Run requires listening on PORT from env
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
