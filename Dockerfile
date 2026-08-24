FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/sites
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
