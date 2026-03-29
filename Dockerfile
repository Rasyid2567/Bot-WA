FROM node:20-slim

# Install yt-dlp + dependencies sistem
RUN apt-get update && apt-get install -y \
    python3 \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node dependencies
COPY package.json .
RUN npm install --omit=dev

# Copy source
COPY . .

# Buat folder session & tmp
RUN mkdir -p /app/session /tmp/wa-bot

EXPOSE 3000

CMD ["node", "index.js"]
