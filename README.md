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

## WebSocket repo subscriptions

Clients can hold one WebSocket open at `/api/v2/ws` and be told when repos change, instead of polling `GET /api/v2/store`. The socket is notify-only: it says *that* a repo changed and gives its new checkpoint, and the client still pulls the change over REST. It speaks JSON-RPC 2.0.

| Call | Direction | Meaning |
| --- | --- | --- |
| `subscribeRepos(Array<[repoId, checkpoint?]>)` | client → server | Returns an array parallel to the params: `-1` malformed entry, `0` failed (keep polling), `1` subscribed and up to date, `2` subscribed and changes are waiting. An omitted checkpoint means `0:0`. |
| `unsubscribeRepos(Array<[repoId]>)` | client → server | Returns nothing. |
| `ping([])` | client → server | Returns `'pong'`. Clients use it to detect a half-open socket. |
| `update(Array<[repoId, checkpoint]>)` | server → client | These repos changed; their checkpoints are now these. |
| `subLost(Array<[repoId]>)` | server → client | These subscriptions are gone; poll or resubscribe. |

Repos are identified by repo ID (the base58 double SHA-256 of the sync key), never by sync key. A client subscribes with the newest entry of its checkpoint array, and must resubscribe with the checkpoint of its last completed sync, never one taken from an `update`.

Limits, all in `config.json`: 100 entries per call (`wsMaxReposPerSubscribe`), 200 subscriptions per socket (`wsMaxSubscriptionsPerConnection`; overflow entries answer `0`), 20 sockets per client IP (`wsMaxConnectionsPerIp`), 10 subscribe calls per minute per socket, 64 KB frames, and a server ping every 30 seconds with the socket dropped after two missed pongs.

The cluster master runs one CouchDB `_changes` longpoll feed for the whole host and forwards changes only to the workers whose sockets watch the changed repos, after merging each repo's changes over a 500 ms window (`changeFeedCoalesceMs`). A watchdog replaces the feed when no poll completes within two longpoll timeouts, and the master exits after ten replacements in a row (`changeFeedMaxRestarts`), so the process manager restarts the host rather than leaving subscriptions silent.

### Reverse proxy

The proxy must pass the upgrade through and keep idle sockets open. For nginx:

```nginx
location /api/v2/ws {
  proxy_pass http://127.0.0.1:8008;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 3600s;
}
```

The per-IP limit uses the last `X-Forwarded-For` entry when the connection comes from loopback.

### Load test

`node -r sucrase/register src/bin/ws-load-test/index.ts '{"server":"http://127.0.0.1:8008"}'` opens 1000 sockets with 50 subscriptions each, writes to a few repos, and reports notification latency, CouchDB requests and server memory. Raise `wsMaxConnectionsPerIp` on the server under test first.

## Testing

Testing is done with mocha, supertest, and nyc. Test will use the configuration defined in `config.json`, and it will append a random number to the end of the database name defined as `couchDatabase` in your config.

The following run scripts are available for testing:

- `yarn test` runs all the tests.
- `yarn test.report` runs the tests with test coverage reports (provided by nyc).
- `yarn test.watch` continuously run the tests and watch for source code changes.
