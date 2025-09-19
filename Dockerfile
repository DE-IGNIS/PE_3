# Use the official Node.js LTS Alpine image for smaller size
FROM node:lts-alpine

# Set the working directory inside the container
WORKDIR /app

# Install system dependencies needed by some packages
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    # sqlite3 dependencies
    sqlite \
    sqlite-dev

# Copy package.json and package-lock.json for dependency installation
COPY package*.json ./

# Install project dependencies (production only)
RUN npm ci --only=production

# Copy the rest of the application source code
COPY . .

# Create necessary directories if they don't exist
RUN mkdir -p uploads logs

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node healthcheck.js || exit 1

# Define the command to run the application
CMD ["node", "src/app.js"]