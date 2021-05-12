# Repo Sync Test

The purpose of the repo-sync-test to calculate how many requests (updates/reads)
the servers can handle before repo sync time exceeds a maximum.

## Run scripts

```sh
# Base script
yarn test.repo-sync
# Run with CLI console
yarn test.repo-sync.console
# Continuously run test
yarn test.repo-sync.continuous
# PM2 process
pm2 start pm2/repo-sync-test.json
```

All scripts expect a `config.test.repo-sync.json` config file or the config JSON as
a first argument. The config filename can be controlled with the `CONFIG` env.

A `LOG_LEVEL` env can be set to control the LOG_LEVEL for each command
(default pino log levels).
