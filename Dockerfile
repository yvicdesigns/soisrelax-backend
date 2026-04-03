FROM node:20-alpine

WORKDIR /app

# Dépendances
COPY package*.json ./
RUN npm ci --only=production

# Code source
COPY src ./src

# Dossier uploads
RUN mkdir -p uploads

EXPOSE 5000

CMD ["node", "src/server.js"]
