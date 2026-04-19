FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer cache).  npm ci uses the workspace root's
# package.json + lockfile, which installs every workspace package's deps.
COPY app/package.json app/package-lock.json* ./
COPY app/packages/shared/package.json packages/shared/
COPY app/packages/server/package.json packages/server/
COPY app/packages/web/package.json packages/web/
COPY app/packages/lambda/interactions/package.json packages/lambda/interactions/
COPY app/packages/lambda/followup/package.json packages/lambda/followup/
COPY app/packages/lambda/update-dns/package.json packages/lambda/update-dns/
COPY app/packages/lambda/watchdog/package.json packages/lambda/watchdog/
RUN npm ci --ignore-scripts

# Copy source and build the server + web bundle for the management app. The
# Lambda packages are NOT built here — they are bundled and deployed by
# `terraform apply` (see `setup.sh`) and have no place inside the container.
COPY app/ .
RUN npm run build

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "packages/server/dist/main.js"]
