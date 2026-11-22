import { describe, expect, it } from 'vitest';
import type { Folder, Identity } from '../types';
import { identitiesToCsv } from '../lib/identity-export';
import { buildIdentities, identityMappingFor, looksLikeIdentities } from '../lib/identity-import';
import { buildSummaryNote, detectSchema, parseInput, type ColumnMapping } from '../lib/data-import';

const folders: Folder[] = [{ id: 'case', name: 'Halvorsen BEC', order: 0, createdAt: 1 }];
const make = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [],
  details: [], connections: [], tags: [], trashed: false, archived: false, createdAt: Date.UTC(2026, 10, 1), updatedAt: Date.UTC(2026, 10, 2), ...extra });
const org = make('org', 'Halvorsen Shipping', { type: 'organization' });
const lee = make('lee', 'Lee Park', { description: 'Finance director', connections: [{ targetId: 'org', label: 'works at' }] });
const dana = make('dana', 'Dana Okafor', { status: 'compromised', contact: true, aliases: ['Okafor, Dana'],
  details: [{ id: 'e', label: 'Email', value: 'dana@halvorsen.example' }, { id: 'p', label: 'Phone', value: '+44 7700 900123', private: true }],
  connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'lee', label: 'reports to' }] });
const all = [org, lee, dana];
const byId = new Map(all.map(identity => [identity.id, identity]));

/** Parses CSV the way Data Import does and maps it the way it detects. */
function reimport(csv: string, existing: Identity[], extra: Partial<Parameters<typeof buildIdentities>[2]> = {}) {
  const parsed = parseInput(csv.replace(/^\uFEFF/, ''));
  const mappings = new Map<string, ColumnMapping>(detectSchema(parsed.headers).map(detection => [detection.column, detection.mapping]));
  return { parsed, mappings, result: buildIdentities(parsed.rows, mappings, { folderId: 'case', existing, now: 5, ...extra }) };
}

describe('CSV export', () => {
  it('writes one row per identity and one column per detail, leaving private details out unless asked', () => {
    const csv = identitiesToCsv(all, { byId, folders });
    expect(csv.startsWith('\uFEFFName,Type,Investigation,Status,Contact,Description,Organization,Other names,Email,Connections,Classification,Created,Updated\r\n')).toBe(true);
    expect(csv).not.toContain('7700');
    expect(csv).toContain('Dana Okafor,person,Halvorsen BEC,compromised,yes,,Halvorsen Shipping,"Okafor, Dana",dana@halvorsen.example,"works at: Halvorsen Shipping\nreports to: Lee Park"');
    const withPrivate = identitiesToCsv(all, { byId, folders, includePrivate: true });
    expect(withPrivate).toContain(',Phone (private),');
    expect(withPrivate).toContain("'+44 7700 900123");
  });

  it('cannot carry a spreadsheet formula', () => {
    const hostile = make('h', '=HYPERLINK("https://example.test","x")', { description: '@SUM(A1)', aliases: ['-2+3'],
      details: [{ id: 'd', label: '+cmd', value: '=1+1' }] });
    const csv = identitiesToCsv([hostile], { byId: new Map([[hostile.id, hostile]]), folders });
    for (const cell of csv.split(/,|\r\n/)) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+\-@]/);
  });
});

describe('import', () => {
  it('recognises an exported file and maps its columns to identity fields', () => {
    const headers = ['Name', 'Type', 'Investigation', 'Status', 'Contact', 'Description', 'Organization', 'Other names', 'Email', 'Phone (private)', 'Reports to', 'Connections', 'Classification', 'Created', 'Updated'];
    expect(looksLikeIdentities(headers)).toBe(true);
    expect(looksLikeIdentities(['timestamp', 'name', 'type'])).toBe(false);
    expect(headers.map(identityMappingFor)).toEqual(['identity-name', 'identity-type', 'ignore', 'identity-status', 'identity-contact', 'identity-description',
      'identity-organization', 'identity-aliases', 'identity-detail', 'identity-detail', 'identity-connection', 'identity-connections', 'identity-classification', 'ignore', 'ignore']);
  });

  it('round-trips an export into an empty investigation, private details still private', () => {
    const { result } = reimport(identitiesToCsv(all, { byId, folders, includePrivate: true }), []);
    expect(result.errors).toEqual([]);
    expect(result.updated).toEqual([]);
    const created = new Map(result.created.map(identity => [identity.name, identity]));
    expect([...created.keys()].sort()).toEqual(['Dana Okafor', 'Halvorsen Shipping', 'Lee Park']);
    const imported = created.get('Dana Okafor') as Identity;
    expect(imported).toMatchObject({ type: 'person', status: 'compromised', contact: true, aliases: ['Okafor, Dana'], folderId: 'case', tags: ['data-import'] });
    expect(imported.details.map(({ label, value, private: hidden }) => ({ label, value, hidden: !!hidden }))).toEqual([
      { label: 'Email', value: 'dana@halvorsen.example', hidden: false }, { label: 'Phone', value: '+44 7700 900123', hidden: true }]);
    const name = (id: string) => result.created.find(identity => identity.id === id)?.name;
    expect(imported.connections.map(edge => `${edge.label}: ${name(edge.targetId)}`).sort()).toEqual(['reports to: Lee Park', 'works at: Halvorsen Shipping']);
  });

  it('marks a public detail whose label is private by default "(public)", so it imports back public', () => {
    const shared = { ...make('lee', 'Lee Park'), details: [{ id: 'w', label: 'Phone', value: '+44 20 7946 0101' }, { id: 'h', label: 'Phone', value: '+44 7700 900111', private: true }] };
    const csv = identitiesToCsv([shared], { byId: new Map([[shared.id, shared]]), folders, includePrivate: true });
    expect(csv.split('\r\n')[0]).toContain('Phone (public),Phone (private)');
    const lee = reimport(csv, []).result.created[0];
    expect(lee.details.map(({ label, value, private: hidden }) => [label, value, !!hidden])).toEqual([['Phone', '+44 20 7946 0101', false], ['Phone', '+44 7700 900111', true]]);
  });

  it('round-trips a custom phrase or a name that holds ": " in the combined Connections column', () => {
    const shell = make('shell', 'Ops: Shell Co', { type: 'organization' });
    const dana = { ...make('dana', 'Dana Okafor'), connections: [{ targetId: 'lee', label: 'met at: the summit with' }, { targetId: 'shell', label: 'audited' }] };
    const rows = [dana, make('lee', 'Lee Park'), shell];
    const csv = identitiesToCsv(rows, { byId: new Map(rows.map(row => [row.id, row])), folders, includePrivate: false });
    const { result } = reimport(csv, []);
    expect(result.errors).toEqual([]);
    const created = result.created.find(identity => identity.name === 'Dana Okafor') as Identity;
    const name = (id: string) => result.created.find(identity => identity.id === id)?.name;
    expect(created.connections.map(edge => `${edge.label} → ${name(edge.targetId)}`).sort()).toEqual(['audited → Ops: Shell Co', 'met at: the summit with → Lee Park']);
  });

  it('never duplicates: importing the same file again changes nothing, and a matching row fills only what is missing', () => {
    const csv = identitiesToCsv(all, { byId, folders, includePrivate: true });
    expect(reimport(csv, all).result).toEqual({ created: [], updated: [], errors: [] });
    const sparse = make('dana', 'Dana Okafor', { status: 'suspicious' });
    const { result } = reimport('Name,Status,Description,Email,Other names\nD. Okafor,cleared,Accounts payable,dana@halvorsen.example,\nDana Okafor,,,DANA@halvorsen.example,"Okafor, Dana"\n',
      [{ ...sparse, aliases: ['D. Okafor'] }]);
    expect(result.created).toEqual([]);
    expect(result.updated).toHaveLength(1);
    // The status stays as it was; the description, one email and the other name are added.
    expect(result.updated[0].changes).toMatchObject({ description: 'Accounts payable', aliases: ['D. Okafor', 'Okafor, Dana'] });
    expect(result.updated[0].changes).not.toHaveProperty('status');
    expect(result.updated[0].changes.details?.map(detail => detail.value)).toEqual(['dana@halvorsen.example']);
  });

  it('creates missing organisations, uses the chosen one for rows without, and reads "reverse" phrases', () => {
    const { result } = reimport('Name,Type,Organization,Manages\nLee Park,person,Halvorsen Shipping,Dana Okafor\nDana Okafor,,,\nWS-0231,system,,\n', [],
      { defaultOrganizationId: undefined });
    const byName = new Map(result.created.map(identity => [identity.name, identity]));
    const company = byName.get('Halvorsen Shipping') as Identity;
    expect(company.type).toBe('organization');
    expect(byName.get('Lee Park')?.connections).toContainEqual({ targetId: company.id, label: 'works at' });
    // "Lee manages Dana" is stored as "Dana reports to Lee".
    expect(byName.get('Dana Okafor')?.connections).toEqual([{ targetId: byName.get('Lee Park')?.id, label: 'reports to' }]);
    const chosen = reimport('Name,Type\nAna Silva,person\nWS-0231,system\n', [org], { defaultOrganizationId: 'org' }).result.created;
    expect(chosen.map(identity => identity.connections)).toEqual([[{ targetId: 'org', label: 'works at' }], [{ targetId: 'org', label: 'belongs to' }]]);
  });

  it('reports rows without a name and connections to someone not in the investigation, and skips them', () => {
    const { result } = reimport('Name,Type,Reports to\n,person,\nLee Park,person,Nobody Known\n', []);
    expect(result.created.map(identity => identity.name)).toEqual(['Lee Park']);
    expect(result.errors).toEqual(['Row 2: no name; skipped.', 'Row 3: “Nobody Known” (Reports to) is not an identity in this investigation; that connection was skipped.']);
  });

  it('keeps identities in other investigations and trashed ones out of matching', () => {
    const elsewhere = make('else', 'Lee Park', { folderId: 'other' });
    const binned = make('bin', 'Dana Okafor', { trashed: true });
    const { result } = reimport('Name,Type\nLee Park,person\nDana Okafor,person\n', [elsewhere, binned]);
    expect(result.created.map(identity => identity.name)).toEqual(['Lee Park', 'Dana Okafor']);
    expect(result.updated).toEqual([]);
  });

  it('handles 10,000 rows quickly', () => {
    const csv = 'Name,Type,Email,Organization\n' + Array.from({ length: 10_000 }, (_, i) => `Person ${i},person,p${i}@example.test,Company ${i % 50}`).join('\n');
    const started = performance.now();
    const { result } = reimport(csv, []);
    expect(result.created).toHaveLength(10_050);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('keeps log and indicator exports as they were detected, and still recognises identity lists', () => {
    const mapped = (headers: string[]) => detectSchema(headers).map(detection => detection.mapping);
    expect(mapped(['name', 'status', '_time', 'src_ip', 'sha256'])).toEqual(expect.arrayContaining(['timestamp', 'ioc-ipv4', 'ioc-sha256']));
    expect(mapped(['name', 'status', '_time', 'src_ip', 'sha256']).some(mapping => mapping.startsWith('identity-'))).toBe(false);
    expect(mapped(['name', 'status', 'src_ip'])).toContain('ioc-ipv4');
    expect(mapped(['Name', 'Type', 'Email', 'Hostname'])).toEqual(['identity-name', 'identity-type', 'identity-detail', 'identity-detail']);
    // A recipient list (Name, Email, Status) keeps extracting email indicators, as before identities.
    expect(mapped(['Name', 'Email', 'Status'])).toContain('ioc-email');
    expect(mapped(['Name', 'Email', 'Status']).some(mapping => mapping.startsWith('identity-'))).toBe(false);
    expect(mapped(['Name', 'Email', 'Organization'])).toEqual(['identity-name', 'identity-detail', 'identity-organization']);
    // ThreatCaddy's own export is always an identity list, even with Created and IP columns.
    expect(mapped(['Name', 'Other names', 'IP address', 'Connections', 'Created'])).toEqual(['identity-name', 'identity-aliases', 'identity-detail', 'identity-connections', 'ignore']);
  });

  it('round-trips classification, details labelled like a field, and never lowers either', () => {
    const secret = make('s', 'Secret Source', { clsLevel: 'SECRET', details: [{ id: 'r', label: 'Role', value: 'CFO' }, { id: 't', label: 'type', value: 'contractor' }] });
    const csv = identitiesToCsv([secret], { byId: new Map([[secret.id, secret]]), folders });
    expect(csv.split('\r\n')[0]).toContain('Role (detail),type (detail)');
    const { result } = reimport(csv, [], { clsLevel: 'TLP:GREEN' });
    expect(result.created[0]).toMatchObject({ clsLevel: 'SECRET', type: 'person' });
    expect(result.created[0].details.map(({ label, value }) => `${label}=${value}`)).toEqual(['Role=CFO', 'type=contractor']);
  });

  it('gives the chosen organisation only to identities that belong to none, and records who imported', () => {
    const acme = make('acme', 'Acme', { type: 'organization' });
    const globex = make('globex', 'Globex', { type: 'organization' });
    const alice = make('alice', 'Alice', { connections: [{ targetId: 'acme', label: 'works at' }] });
    const { result } = reimport('Name,Type\nAlice,person\nBob,person\n', [acme, globex, alice], { defaultOrganizationId: 'globex', author: 'Fictional analyst' });
    expect(result.updated).toEqual([]);
    expect(result.created).toEqual([expect.objectContaining({ name: 'Bob', createdBy: 'Fictional analyst', connections: [{ targetId: 'globex', label: 'works at' }] })]);
    const touched = reimport('Name,Status\nAlice,suspicious\n', [alice], { author: 'Fictional analyst' }).result.updated;
    expect(touched).toEqual([{ id: 'alice', changes: { status: 'suspicious', updatedBy: 'Fictional analyst' } }]);
  });

  it('keeps private columns out of the import summary note, however they were mapped', () => {
    const parsed = parseInput('Name,Email,Phone,Home address (private)\nDana Okafor,dana@halvorsen.example,+44 7700 900999,1 Fictional Road\n');
    const mappings = new Map<string, ColumnMapping>(detectSchema(parsed.headers).map(detection => [detection.column, detection.mapping]));
    const summary = buildSummaryNote(parsed, mappings, { timelineEventsCreated: 0, iocsExtracted: 0, identitiesCreated: 1, identitiesUpdated: 0, summaryNoteCreated: true, errors: [] });
    expect(summary.content).toContain('dana@halvorsen.example');
    expect(summary.content).not.toContain('7700');
    expect(summary.content).not.toContain('Fictional Road');
  });

  it('reports a name two identities share, another identity\'s name as an other name, and a person given as organization', () => {
    const twinA = make('a', 'Sam Lee');
    const twinB = make('b', 'Sam Lee');
    const lee = make('lee', 'Lee Park');
    const { result } = reimport('Name,Type,Other names,Organization\nSam Lee,person,,\nAna Silva,person,Lee Park,Lee Park\n', [twinA, twinB, lee]);
    expect(result.updated).toEqual([]);
    expect(result.created.map(identity => [identity.name, identity.aliases, identity.connections])).toEqual([['Ana Silva', [], []]]);
    expect(result.errors).toEqual([
      'Row 2: “Sam Lee” names more than one identity in this investigation; skipped. Merge them, then import again.',
      'Row 3: “Lee Park” is already another identity\'s name; not added as another name of “Ana Silva”.',
      'Row 3: “Lee Park” is not one organization in this investigation; its organization was skipped.',
    ]);
  });

  it('treats interface-language private labels as private, and undoes the formula apostrophe in headers', () => {
    const { result } = reimport("Name,Type,Telefon,'+Extra\nDana Okafor,person,+49 30 1234,x\n", [], { isPrivateLabel: label => label === 'Telefon' });
    expect(result.created[0].details).toEqual([
      expect.objectContaining({ label: 'Telefon', value: '+49 30 1234', private: true }),
      expect.objectContaining({ label: '+Extra', value: 'x' }),
    ]);
    expect(result.created[0].details[1]).not.toHaveProperty('private');
  });

  it('exports organisations and connections only to identities in the file', () => {
    const archivedOrg = make('old', 'Old Holdings', { type: 'organization', archived: true });
    const worker = make('w', 'Worker', { connections: [{ targetId: 'old', label: 'works at' }, { targetId: 'lee', label: 'reports to' }] });
    const csv = identitiesToCsv([worker, lee], { byId: new Map([worker, lee, archivedOrg].map(identity => [identity.id, identity])), folders });
    expect(csv).not.toContain('Old Holdings');
    expect(csv).toContain('reports to: Lee Park');
  });
});

