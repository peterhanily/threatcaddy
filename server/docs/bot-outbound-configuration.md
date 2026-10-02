# Bot outbound operations

Outbound HTTP requires `call_external_apis` and a nonempty `allowedDomains` list. An empty list denies all requests. DNS is checked once and the connection is pinned to that address while retaining the original hostname for certificate validation and the HTTP Host header. Redirects are rejected. Requests are limited to 2 MiB and responses to 5 MiB after decompression; the 30-second deadline includes DNS and body consumption. Stopping the bot cancels active requests.

SSH requires `execute_remote`, an explicit `allowedHosts` entry, a non-private resolved address, an explicit username, and a verified server host fingerprint. Obtain the fingerprint through the host administrator or another independently trusted channel; do not automatically trust a key discovered on first connection.

Legacy `allowedCommands` prefix permissions are intentionally no longer accepted. Migrate them to named `sshOperations` with an absolute executable and fixed argument array. The tool's `command` field now selects the operation name; it does not accept shell text or additional arguments.

```json
{
  "allowedHosts": ["operations.example"],
  "sshOperations": {
    "health": { "executable": "/usr/local/bin/health-report", "args": ["--summary"] }
  },
  "sshCredentials": {
    "operations.example": {
      "username": "monitor",
      "hostFingerprint": "SHA256:<verified 43-character unpadded base64 digest>",
      "privateKey": "<operator-provided key>"
    }
  }
}
```

SSH connects to the checked address and compares the received host key with the configured SHA256 fingerprint. Account permissions on the destination should be restricted to the approved operations. Rotation requires an explicit trusted update of the fingerprint. Existing bots lacking this configuration fail with an actionable error; they do not fall back to unverified execution.

Manual runs execute schedule-capable bot implementations. Event-only/enrichment bots require their normal event or webhook context and return an explicit unsupported-manual-run error, rather than a successful no-op. Disable/reload/shutdown cancels pending work and active provider requests. Provider responses are bounded to 2 MiB and provider deadlines cover response bodies as well as connection setup.

## AgentCaddy execution availability

Browser-local AgentCaddy workflows remain separate from ordinary administrator-configured server bots. Server AgentCaddy registration preserves disabled metadata only: it does not start work, take over when the browser closes, or grant new capabilities. `/api/server/info` advertises `capabilities.agentCaddyServerHandoff: false`. Registration and status return `serverExecutionAvailable: false`; heartbeat and manual handoff triggers return HTTP 503 with the unavailable reason. Reviewing a historic action records a review decision but does not execute it.

There is no server-side parity promise for browser tool restrictions, read-only entity policies, durable approvals, or per-deployment ownership leases. Handoff stays unavailable until those execution boundaries are implemented and verified. Closing this unsafe execution path is an intentional capability restriction, not a claim that autonomous handoff is complete.
