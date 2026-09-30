# edge-sync-server

## Unreleased

- added: WebSocket repo subscriptions on `/api/v2/ws`: `subscribeRepos`, `unsubscribeRepos` and `ping`, with `update` and `subLost` notifications.
- added: The cluster master hosts one CouchDB change feed per host, with a watchdog.
- added: `ws-load-test` script.
- changed: The store database name is configurable with `storeDatabaseName`.
- fixed: Conflict resolution reads from the connected store database instead of always `sync_store`.
- removed: The unused `subscribeRepo` and `unsubscribeRepo` prototype methods.

## 0.1.1 (2026-03-10)

- fixed: Fixed call-stack overflow bug when calculating latest checkpoint.
