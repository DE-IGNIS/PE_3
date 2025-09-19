FROM node:lts-alpine

WORKDIR /app

# Install OS-level dependencies needed to build native modules (like sqlite3)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    # Specifically for sqlite3:
    sqlite-dev

# Copy package files
COPY package*.json ./

# Install npm dependencies (this will now compile sqlite3 for Alpine)
RUN npm install

# Copy application source
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]