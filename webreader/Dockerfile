FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV WEBREADER_PORT=3000
ENV YACR_SERVER_URL=http://yacreaderlibrary-server-docker:8080

EXPOSE 3000

CMD ["npm", "start"]
