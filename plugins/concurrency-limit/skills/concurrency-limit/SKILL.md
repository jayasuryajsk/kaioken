---
name: concurrency-limit
description: "Inspect or change global and per-host limits on concurrently running Kaioken threads."
---

# Concurrency limits

Use `kaioken concurrency-limit status --json` to inspect current limits.

```sh
kaioken concurrency-limit global [unlimited|<limit>] [--json]
kaioken concurrency-limit host <host-id> [auto|<limit>] [--json]
```

Automatic host limits allow one thread per available processor. Resolve the host
with `kaioken machine list` before changing a host limit. Omit the value to inspect it;
change limits only for the requested scope and verify the resulting status.
