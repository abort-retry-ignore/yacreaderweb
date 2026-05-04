FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public

ENV WEBREADER_PORT=3000
ENV YACR_SERVER_URL=http://localhost:60000

EXPOSE 3000

CMD ["npm", "start"]
