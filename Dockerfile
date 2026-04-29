FROM node:18-alpine

WORKDIR /app

# Install PostgreSQL client libraries for pg module
RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data

EXPOSE 10000

CMD ["npm", "start"]
