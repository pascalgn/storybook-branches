FROM node:alpine

RUN apk add --no-cache tini curl git openssh-client tar openssl bash \
    && adduser -D -g storybook-branches storybook-branches

COPY . /tmp/src/

RUN yarn global add "file:/tmp/src" \
    && cp /tmp/src/entrypoint.sh /usr/local/bin/ \
    && rm -rf /tmp/src

WORKDIR /home/storybook-branches
USER storybook-branches
ENTRYPOINT [ "/sbin/tini", "--", "/bin/sh", "/usr/local/bin/entrypoint.sh" ]
