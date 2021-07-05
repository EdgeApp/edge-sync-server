# Load Test

The purpose of the load-test is to ramp up the number of concurrent repos to be
reading/writing to at a rate similar to the app client.

## Run scripts

```sh
# Base script
yarn test.load
# Run with CLI console
yarn test.load.console
# PM2 process
pm2 start pm2/load-test.json
```

All scripts expect a `config.test.load.json` config file or the config JSON as
a first argument. The config filename can be controlled with the `CONFIG` env.

A `LOG_LEVEL` env can be set to control the LOG_LEVEL for each command
(default pino log levels).
