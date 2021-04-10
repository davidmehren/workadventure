# typescript build
FROM node:14.16.1-buster-slim@sha256:f5ca34ff9a862fd26e803778b0c96638c2a20a3ca60fbf4ed959005aa8132290 as builder2
WORKDIR /usr/src
COPY uploader/yarn.lock uploader/package.json ./
RUN yarn install
COPY uploader .
ENV NODE_ENV=production
RUN yarn run tsc

# final production image
FROM node:14.16.1-buster-slim@sha256:f5ca34ff9a862fd26e803778b0c96638c2a20a3ca60fbf4ed959005aa8132290
WORKDIR /usr/src
COPY uploader/yarn.lock uploader/package.json ./
COPY --from=builder2 /usr/src/dist /usr/src/dist
ENV NODE_ENV=production
RUN yarn install --production

USER node
CMD ["yarn", "run", "runprod"]
