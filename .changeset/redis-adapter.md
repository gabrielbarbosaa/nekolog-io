---
'@nekolog-io/adapters': minor
---

Implement `RedisClient` twice without taking a dependency on either vendor: `upstashRedis` speaks the REST API, so it runs in a Worker with nothing but `fetch`, and `nodeRedis` takes an ioredis-shaped client the caller injects, the way `kvKeyStore` takes a KV binding.

Scripts run by hash. Both implementations keep the SHA from `SCRIPT LOAD` and call `EVALSHA` afterwards, falling back to sending the text once when the server answers `NOSCRIPT` — which happens after a restart or a failover. Upstash's free tier counts commands, and the one-time-code script is dozens of lines that would otherwise travel on every login. An error that is not `NOSCRIPT` is rethrown, because a replica's `READONLY` must not turn into "send the script again".

`prefixedRedis` namespaces every key by environment, including the `KEYS` an `eval` receives but not its `ARGV`: an argument is data, not an address. Without that, `dev` and `prod` sharing one Upstash would read each other's sessions.

The integration tests run the one-time-code scripts from the plan against a real Redis and check, through `INFO commandstats`, that the second call never resends the script.
