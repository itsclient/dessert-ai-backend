# Dockerfile for Render.com deployment
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all backend files
COPY . .

# Create directory for database
RUN mkdir -p /app/data

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/admin/stats', (r) => {process.exit(0)}).on('error', () => {process.exit(1)})"

# Start the server
CMD ["node", "server.js"]
