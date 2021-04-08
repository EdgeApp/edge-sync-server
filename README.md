# Edge Sync Server

A HTTP API server to store, retrieve, and synchronize encrypted data between clients and servers. It uses CouchDB as the backend and Express as the HTTP server.

## Usage

### Install

```
yarn
```

### Configuration

A default config `config.json` is automatically created on install. The schema for this file is located in `src/config.ts` and uses [cleaners](https://www.npmjs.com/package/cleaners) for type definitions.

You can use `yarn configure` to re-create the config file if removed.

The config file path can be customized with the `CONFIG` env var.

### Scripts

#### Running Source

```
yarn start
```

#### Running for Development

There is a convenient "dev" script for running a development server which uses nodemon and sucrase to run the server.

```
yarn start.dev
```

#### Build

```
yarn prepare
```

#### Running Build for Production

```
pm2 start pm2.json
```

## Testing

Testing is done with mocha, supertest, and nyc. Test will use the configuration defined in `config.json`, and it will append a random number to the end of the database name defined as `couchDatabase` in your config.

The following run scripts are available for testing:

- `yarn test` runs all the tests.
- `yarn test.report` runs the tests with test coverage reports (provided by nyc).
- `yarn test.watch` continuously run the tests and watch for source code changes.
