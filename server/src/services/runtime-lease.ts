import postgres, { type TransactionSql } from 'postgres';

export const RUNTIME_LEASE_KEY = 'threatcaddy:single-instance:v1';

export async function assertServerStopped(tx: TransactionSql): Promise<void> {
  const [row] = await tx`SELECT pg_try_advisory_xact_lock(hashtextextended(${RUNTIME_LEASE_KEY}, 0)) AS acquired`;
  if (!row?.acquired) throw new Error('A server instance is running; stop it before this operation');
}

/** Startup guard, not a distributed worker/fencing protocol. A dedicated socket
 * holds the lease; connection loss is fatal rather than silently reacquiring it. */
export async function acquireRuntimeLease(url: string, onLost: () => void): Promise<() => Promise<void>> {
  let held = false;
  let closing = false;
  let pinging = false;
  const connection = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 5, onnotice: () => {},
    onclose: () => { if (held && !closing) { held = false; onLost(); } },
  });
  try {
    const [row] = await connection`SELECT pg_try_advisory_lock(hashtextextended(${RUNTIME_LEASE_KEY}, 0)) AS acquired`;
    if (!row?.acquired) throw new Error('Another ThreatCaddy server already owns this database; only one instance is supported');
    held = true;
  } catch (error) { closing = true; await connection.end({ timeout: 1 }); throw error; }
  const timer = setInterval(() => {
    if (!held || closing || pinging) return;
    pinging = true;
    void connection`SELECT 1`.catch(() => { if (held && !closing) { held = false; onLost(); } }).finally(() => { pinging = false; });
  }, 5_000);
  timer.unref();
  return async () => {
    closing = true;
    held = false;
    clearInterval(timer);
    await connection.end({ timeout: 2 });
  };
}
