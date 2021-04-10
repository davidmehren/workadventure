# protobuf build
FROM node:14.16.1-buster-slim@sha256:f5ca34ff9a862fd26e803778b0c96638c2a20a3ca60fbf4ed959005aa8132290 as builder
WORKDIR /usr/src
COPY messages .
RUN yarn install && yarn proto

# typescript build
FROM node:14.16.1-buster-slim@sha256:f5ca34ff9a862fd26e803778b0c96638c2a20a3ca60fbf4ed959005aa8132290 as builder2
WORKDIR /usr/src
COPY pusher/yarn.lock pusher/package.json ./
RUN yarn install
COPY pusher .
COPY --from=builder /usr/src/generated src/Messages/generated
ENV NODE_ENV=production
RUN yarn run tsc

# final production image
FROM node:14.16.1-buster-slim@sha256:f5ca34ff9a862fd26e803778b0c96638c2a20a3ca60fbf4ed959005aa8132290
WORKDIR /usr/src
COPY pusher/yarn.lock pusher/package.json ./
COPY --from=builder2 /usr/src/dist /usr/src/dist
ENV NODE_ENV=production
RUN yarn install --production

USER node
CMD ["yarn", "run", "runprod"]
