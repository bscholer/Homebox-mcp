FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Copy config example (users can mount their own config.json)
COPY config.json.example ./

# Create a directory for config
RUN mkdir -p /config

# Set environment variables (can be overridden)
ENV HOMEBOX_URL=http://homebox:7745
ENV HOMEBOX_EMAIL=
ENV HOMEBOX_PASSWORD=
ENV MCP_TRANSPORT=stdio
ENV MCP_HTTP_PORT=3000

# The server will look for config in this order:
# 1. /config/config.json (mounted volume)
# 2. Environment variables
# 3. ./config.json (in the app directory)

EXPOSE 3000

# MCP_TRANSPORT=stdio (default) keeps the container idling for `docker exec` /
# `kubectl exec`. Set MCP_TRANSPORT=http to have the server listen on
# MCP_HTTP_PORT instead, for network clients.
CMD ["sh", "-c", "if [ \"$MCP_TRANSPORT\" = \"http\" ]; then node dist/index.js; else tail -f /dev/null; fi"]
