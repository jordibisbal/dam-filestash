FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
COPY caption-plugin.js ./
RUN npm run build
CMD ["node", "dist/index.js"]
