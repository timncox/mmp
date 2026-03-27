FROM node:20-slim

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Install app deps
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci

# Copy all source
COPY server/ ./server/
COPY app/ ./app/
COPY spec/ ./spec/

# Build the MCP App inbox UI
RUN cd app && npm run build

# Environment
ENV PORT=3777
ENV MMP_DB_PATH=/data/mmp.db

EXPOSE 3777

WORKDIR /app/server
CMD ["npx", "tsx", "server.ts"]
