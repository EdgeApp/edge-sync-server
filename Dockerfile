FROM node:14.16.0-alpine3.13

EXPOSE 8008

ARG COUCH_HOSTNAME
ARG COUCH_PASSWORD

# Install git
RUN apk add git

# Install ab-sync
COPY shared-bin/ab-sync_alpine3.13 /usr/local/bin/ab-sync
RUN chmod 755 /usr/local/bin/ab-sync
COPY shared-bin/libgit2.so.23_alpine3.13 /usr/local/lib/libgit2.so.23
RUN chmod 755 /usr/local/lib/libgit2.so.23

# Install PM2
RUN npm install -g pm2

# Set working directory to /usr/app
WORKDIR /usr/app

# Copy project files
COPY package.json .
COPY yarn.lock .

# Install deps
RUN yarn install --ignore-scripts

# Copy project files
COPY ./ ./

# Build
RUN yarn prepare

# Setup config file
RUN yarn setup

# Run app
CMD [ "pm2-runtime", "pm2.json" ]