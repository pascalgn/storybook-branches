# storybook-branches

[![Docker build status](https://img.shields.io/docker/build/pascalgn/storybook-branches.svg?style=flat-square)](https://hub.docker.com/r/pascalgn/storybook-branches/) [![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/pascalgn/storybook-branches/blob/master/LICENSE)

Provide [storybook](https://storybook.js.org/) builds for multiple branches

## Usage

Start 

    docker run --rm -it \
        -p 9001:9001 \
        -e "REPOSITORY=https://github.com/some/repository" \
        -e "DIR=some/directory/" \
        -e "BRANCHES=master" \
        pascalgn/storybook-branches

## Options

The following environment variables are required:

* `REPOSITORY` The URL of the remote repository

Additionally, the following environment variables are supported:

* `DIR` The subdirectory within the repository (default _._)
* `PORT` The port to run the HTTP server on (default _9001_)
* `BRANCHES` Regular expression filter of the branches to build (default _.+_)
* `SLEEP` The time to sleep between fetches, in seconds (default _60_)
* `OUTPUT` The output directory (default _dist_)
* `LOG_LEVEL` A [winston](https://github.com/winstonjs/winston) log level (default _info_)

Additionally, the following environment variables are available for
providing SSH keys, to connect to the remote repository:

* `KNOWN_HOSTS` The SSH host keys (stored in `~/.ssh/known_hosts`)
* `ID_RSA` The private SSH key (stored in `~/.ssh/id_rsa`)

## License

MIT
