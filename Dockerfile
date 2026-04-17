FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY app/package.json app/package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY app/ .
RUN npm run build

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/server/index.js"]
