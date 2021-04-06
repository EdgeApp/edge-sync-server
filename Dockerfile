FROM node:14.16.0-alpine3.13

EXPOSE 8008

# Install git
RUN apk add git

# Install ab-sync
COPY shared-bin/ab-sync_alpine3.13 /usr/local/bin/ab-sync
RUN chmod 755 /usr/local/bin/ab-sync
COPY shared-bin/libgit2.so.23_alpine3.13 /usr/local/lib/libgit2.so.23
RUN chmod 755 /usr/local/lib/libgit2.so.23

# Install PM2
RUN npm install -g pm2

# PM2 log rotation
RUN pm2 install pm2-logrotate

# Set working directory to /usr/app
WORKDIR /usr/app

# Set logs directory
VOLUME [ "./logs" ]

# Copy project files
COPY package.json .
COPY yarn.lock .

# Install deps
RUN yarn install --ignore-scripts

# Copy project files
COPY pm2.json .
COPY config.json .
COPY src src/

# Build
RUN yarn build.lib

# Run app
CMD [ "pm2-runtime", "pm2.json" ]