FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
