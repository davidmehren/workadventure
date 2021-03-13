# typescript build
FROM node:14.15.4-buster-slim@sha256:c8b73b9968457ee4969050955031efe0943d7770e38eeec2943debefd4d28cfd as builder2
WORKDIR /usr/src
COPY uploader/yarn.lock uploader/package.json ./
RUN yarn install
COPY uploader .
ENV NODE_ENV=production
RUN yarn run tsc

# final production image
FROM node:14.15.4-buster-slim@sha256:c8b73b9968457ee4969050955031efe0943d7770e38eeec2943debefd4d28cfd
WORKDIR /usr/src
COPY uploader/yarn.lock uploader/package.json ./
COPY --from=builder2 /usr/src/dist /usr/src/dist
ENV NODE_ENV=production
RUN yarn install --production

USER node
CMD ["yarn", "run", "runprod"]
