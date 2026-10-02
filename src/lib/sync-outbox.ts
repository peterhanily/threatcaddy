import Dexie, { type DBCoreTransaction, type DBCoreMutateRequest } from 'dexie';
import { isSyncEnabled, isSyncSuppressed, isSyncTable, notifyOutboxCommit, revisionKey } from './sync-state';

/** Include the durable outbox in every captured entity transaction, including
 * implicit single-table writes. Runs above encryption so queue payloads are
 * encrypted by the same lower layer as ordinary entity fields. */
export function installSyncOutbox(db: Dexie) {
  db.use({
    stack: 'dbcore', name: 'sync-outbox', level: 20,
    create(core) {
      const captured = new WeakSet<DBCoreTransaction>();
      const privacyTracked = new WeakSet<DBCoreTransaction>();
      const changed = new WeakSet<DBCoreTransaction>();
      const hasOutbox = core.schema.tables.some(t => t.name === '_syncQueue');
      return {
        ...core,
        transaction(stores, mode, options) {
          const capture = hasOutbox && mode === 'readwrite' && isSyncEnabled() && stores.some(isSyncTable);
          const trackPrivacy = hasOutbox && mode === 'readwrite' && stores.includes('folders');
          const names = capture ? [...new Set([...stores, '_syncQueue', '_syncMeta', 'folders'])]
            : trackPrivacy ? [...new Set([...stores, '_syncMeta'])] : stores;
          const tx = core.transaction(names, mode, options);
          if (trackPrivacy) privacyTracked.add(tx);
          if (capture) {
            captured.add(tx);
            (tx as IDBTransaction).addEventListener('complete', () => {
              if (changed.has(tx)) notifyOutboxCommit();
            });
          }
          return tx;
        },
        table(name) {
          const table = core.table(name);
          if (!isSyncTable(name) || !hasOutbox) return table;
          return {
            ...table,
            async mutate(req: DBCoreMutateRequest) {
              const capture = captured.has(req.trans);
              if ((!capture && !(name === 'folders' && privacyTracked.has(req.trans))) || isSyncSuppressed(req.trans)) return table.mutate(req);
              try {
                const deleting = req.type === 'delete' || req.type === 'deleteRange';
                let before: Record<string, unknown>[] = [];
                if (req.type === 'delete') {
                  before = await table.getMany({ trans: req.trans, keys: req.keys });
                } else if (req.type === 'deleteRange') {
                  before = (await table.query({ trans: req.trans, values: true, query: { index: table.schema.primaryKey, range: req.range } })).result;
                }
                const result = await table.mutate(req);
                const rows: Record<string, unknown>[] = deleting ? before : await table.getMany({
                  trans: req.trans,
                  keys: (result.results ?? []).filter((_, i) => !result.failures[i]),
                });
                const entries: Record<string, unknown>[] = [];
                for (let i = 0; i < rows.length; i++) {
                  const row = rows[i];
                  if (!row || (deleting && result.failures[i])) continue;
                  const id = row.id;
                  if (typeof id !== 'string') throw new Error('Synced entities require string IDs');
                  const folderId = name === 'folders' ? id : row.folderId;
                  if (name === 'folders') {
                    const key = JSON.stringify(['localOnly', id]);
                    // Preserve a privacy change even while transport is off and
                    // after deletion. Do not create sync history for new shared folders.
                    if (row.localOnly === true || await core.table('_syncMeta').get({ trans: req.trans, key })) {
                      const privacy = await core.table('_syncMeta').mutate({ type: 'put', trans: req.trans,
                        values: [{ key, value: row.localOnly === true }] });
                      if (privacy.numFailures) throw Object.values(privacy.failures)[0];
                    }
                  }
                  if (!capture) continue;
                  if (name === 'folders' && row.localOnly === true) continue;
                  if (typeof folderId === 'string' && name !== 'folders') {
                    const folder = await core.table('folders').get({ trans: req.trans, key: folderId });
                    if (folder?.localOnly) continue;
                  }
                  if (!folderId && !['tags', 'timelines'].includes(name)) continue;
                  const revision = await core.table('_syncMeta').get({ trans: req.trans, key: revisionKey(name, id) });
                  entries.push({ table: name, entityId: id, folderId, op: deleting ? 'delete' : 'put',
                    ...(deleting ? {} : { data: row }), clientVersion: revision?.value ?? 0 });
                }
                if (entries.length) {
                  const queued = await core.table('_syncQueue').mutate({ type: 'add', trans: req.trans, values: entries });
                  if (queued.numFailures) throw Object.values(queued.failures)[0];
                  changed.add(req.trans);
                }
                return result;
              } catch (error) {
                req.trans.abort();
                throw error;
              }
            },
          };
        },
      };
    },
  });
}
