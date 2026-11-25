/**
 * Which details start out private, and how a person changes it: the label rule for forms, AI tools
 * and spreadsheet headers (Active Directory, Entra ID, HR exports), the import's Private choice per
 * column, and Make private / Make public on a stored detail.
 */
import { describe, expect, it } from 'vitest';
import { isPrivateLabel, labelWords } from '../lib/identity-model';
import { buildIdentities, identityMappingFor, isPrivateDetailColumn, looksLikeIdentities } from '../lib/identity-import';
import { buildSummaryNote, buildTimelineEvents, detectSchema, parseInput, type ColumnMapping, type ImportResult } from '../lib/data-import';

describe('the private-label rule', () => {
  it('reads labels as words, whatever their spelling', () => {
    expect(labelWords('MobilePhone')).toEqual(['mobile', 'phone']);
    expect(labelWords('telephoneNumber')).toEqual(['telephone', 'number']);
    expect(labelWords('home_phone [Optional]')).toEqual(['home', 'phone', 'optional']);
    expect(labelWords('SSNLast4')).toEqual(['ssn', 'last4']);
    expect(labelWords('IPv4Address')).toEqual(['ipv4', 'address']);
  });

  it('makes phones, street addresses, birth dates and government numbers private, as headers from real exports', () => {
    const privateLabels = [
      // Active Directory (Get-ADUser | Export-Csv) and Entra ID
      'MobilePhone', 'HomePhone', 'OfficePhone', 'telephoneNumber', 'businessPhones', 'StreetAddress', 'PostalCode', 'postalCode', 'streetAddress',
      // HR exports and forms
      'Personal mobile', 'Work phone', 'Street address', 'Passport number', 'National Insurance number', 'Social Security Number', 'SSN',
      'Date of birth', 'DOB', 'Birthday', 'Home address', 'Personal email', 'private e-mail', 'Tax ID', "Driver's licence", 'ID card number',
      'Next of kin', 'Emergency contact', 'Phone', 'Address', 'Fax', 'ZIP code', 'Gender', 'Medical notes',
      // More real headers: UK and AD addresses, phones, government numbers
      'Post Code', 'PostCode', 'POBox', 'postOfficeBox', 'Contact number', 'Landline', 'Pager', 'D.O.B.', 'NI Number', 'Social Insurance Number', 'SIN',
      'Government ID', 'Identity card number', 'Personal ID number', 'PPS number', 'Aadhaar', 'Visa number',
      // German, Spanish, French, Italian, Portuguese and Dutch
      'Telefon', 'Telefonnummer', 'Handynummer', 'Adresse', 'Geburtsdatum', 'Teléfono', 'Dirección', 'Fecha de nacimiento', 'Date de naissance',
      'Indirizzo', 'Codice fiscale', 'Endereço', 'Geboortedatum',
    ];
    for (const label of privateLabels) expect(isPrivateLabel(label), label).toBe(true);
  });

  it('keeps a personal label private whatever else it says (a word that makes an address or phone public does not unmask the rest)', () => {
    for (const label of ['Phone (e.g. +44)', 'Date of birth (from passport)', 'Passport number - source HR', 'Home address (from HR)',
      'Mobile (from HR)', 'Health notes (from GP)', 'Phone - to call back', 'Gender (local records)', 'Medical status', 'Disability status',
      'Salary (local currency)', 'Phone/Email', 'Sexual orientation', 'Political opinion', 'Trade union membership', 'Criminal record',
      'Biometric data', 'Genetic data', 'Religious beliefs', 'Health service number', 'Health insurance card']) expect(isPrivateLabel(label), label).toBe(true);
  });

  it('keeps network and mailbox addresses, accounts and work identifiers public', () => {
    const publicLabels = ['Email', 'EmailAddress', 'Email address', 'E-mail address', 'mail', 'userPrincipalName', 'IP address', 'MAC address',
      'Hostname', 'Domain', 'Username', 'SamAccountName', 'Handle', 'IBAN', 'Asset tag', 'Website', 'Department', 'Title', 'Hotel booking ref',
      'Intel source', 'Bitcoin address', 'HomeDirectory',
      // Mailbox, network and system identifiers (from Exchange, AD, EDR and mail headers)
      'IPv4 address', 'IPv4Address', 'IPv6Address', 'PrimarySmtpAddress', 'proxyAddresses', 'Sender address', 'From address', 'Reply-to address',
      'Source address', 'Remote address', 'SIP address', 'DNS address', 'Mobile device ID', 'Health check URL',
      'RecipientAddress', 'C2 address', 'Callback address', 'Gateway address', 'Health Status', 'Phone model',
      'E-Mail-Adresse', 'Adresse IP', 'Dirección IP', 'Dirección de correo', 'Indirizzo email', 'E-mailadres'];
    for (const label of publicLabels) expect(isPrivateLabel(label), label).toBe(false);
  });

  it('also follows the interface language, as before', () => {
    // Finnish is not in the built-in word list; the interface language's own label still counts.
    expect(isPrivateLabel('Puhelin', ['Puhelin'])).toBe(true);
    expect(isPrivateLabel('Puhelin')).toBe(false);
  });
});

describe('importing a directory export', () => {
  const csv = [
    'Name,displayName,jobTitle,companyName,EmailAddress,MobilePhone,HomePhone,StreetAddress,PostalCode,SamAccountName',
    'Dana Okafor,Dana Okafor,Payments lead,Halvorsen Shipping,dana@halvorsen.example,+44 7700 900123,+44 20 7946 0000,1 Fictional Way,ZZ1 1ZZ,dokafor',
  ].join('\n');
  const parsed = parseInput(csv);
  const mappings = new Map<string, ColumnMapping>(detectSchema(parsed.headers).map(detection => [detection.column, detection.mapping]));

  it('does not take a log with a timestamp column for a list of identities, however the column is written', () => {
    for (const time of ['DateTime', 'TimeStamp', 'timestamp', '@timestamp', '_time', 'EventTime', 'date_time']) {
      expect(looksLikeIdentities([time, 'Name', 'Type', 'Status']), time).toBe(false);
    }
  });

  it('recognises an Entra ID list by its displayName column', () => {
    expect(looksLikeIdentities(['displayName', 'jobTitle', 'mail', 'mobilePhone'])).toBe(true);
    expect(['displayName', 'jobTitle', 'companyName', 'mobilePhone'].map(identityMappingFor))
      .toEqual(['identity-name', 'identity-description', 'identity-organization', 'identity-detail']);
  });

  it('imports phones and addresses as private and the email and account as public, by default', () => {
    const { created } = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: [] });
    const dana = created.find(identity => identity.name === 'Dana Okafor');
    expect(dana?.details.map(({ label, private: hidden }) => [label, !!hidden])).toEqual([
      ['EmailAddress', false], ['MobilePhone', true], ['HomePhone', true], ['StreetAddress', true], ['PostalCode', true], ['SamAccountName', false]]);
  });

  it('follows a person\'s Private choice per column, either way', () => {
    const privateColumns = new Set(['EmailAddress', 'HomePhone']);
    const { created } = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: [], privateColumns });
    const dana = created.find(identity => identity.name === 'Dana Okafor');
    expect(dana?.details.filter(detail => detail.private).map(detail => detail.label)).toEqual(['EmailAddress', 'HomePhone']);
    expect(isPrivateDetailColumn('MobilePhone')).toBe(true);
  });

  it('makes a value already held private when its column is imported as private, and never the reverse', () => {
    const existing = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: [], privateColumns: new Set() }).created;
    const dana = existing.find(identity => identity.name === 'Dana Okafor');
    expect(dana?.details.find(detail => detail.label === 'MobilePhone')?.private).toBeUndefined();
    const again = buildIdentities(parsed.rows, mappings, { folderId: 'case', existing, privateColumns: new Set(['MobilePhone']) });
    expect(again.updated.map(update => update.id)).toEqual([dana?.id]);
    expect(again.updated[0].changes.details?.find(detail => detail.label === 'MobilePhone')?.private).toBe(true);
    // Never the reverse: a column not ticked leaves a private value private.
    const allPrivate = existing.map(identity => (identity === dana ? { ...identity, details: identity.details.map(detail => ({ ...detail, private: true })) } : identity));
    expect(buildIdentities(parsed.rows, mappings, { folderId: 'case', existing: allPrivate, privateColumns: new Set() }).updated).toEqual([]);
  });

  it('keeps a column ticked Private out of the summary note and the events, even one no rule would call private', () => {
    const rows = [{ Timestamp: '2026-11-01T10:00:00Z', Name: 'Dana Okafor', 'Badge notes': 'Escorted visitor 4471', Event: 'Door opened' }];
    const columnMappings = new Map<string, ColumnMapping>([['Timestamp', 'timestamp'], ['Name', 'identity-name'], ['Badge notes', 'identity-detail'], ['Event', 'event-title']]);
    const ticked = new Set(['Badge notes']);
    const result = { eventsCreated: 0, iocsExtracted: 0, errors: [] } as unknown as ImportResult;
    const parseResult = { headers: Object.keys(rows[0]), rows, format: 'csv', totalRowCount: 1, truncated: false } as unknown as Parameters<typeof buildSummaryNote>[0];
    expect(buildSummaryNote(parseResult, columnMappings, result, 'case', undefined, ticked).content).not.toContain('4471');
    expect(buildSummaryNote(parseResult, columnMappings, result, 'case').content).toContain('4471');
    expect(buildTimelineEvents(rows, columnMappings, 'timeline', 'case', ticked).events[0].rawData).not.toContain('4471');
    expect(buildTimelineEvents(rows, columnMappings, 'timeline', 'case').events[0].rawData).toContain('4471');
  });

  it('keeps private columns out of the summary note and out of the events\' raw data', () => {
    const privateColumns = new Set(['MobilePhone', 'HomePhone', 'StreetAddress', 'PostalCode']);
    const result = { eventsCreated: 0, iocsExtracted: 0, errors: [] } as unknown as ImportResult;
    const note = buildSummaryNote(parsed, mappings, result, 'case', undefined, privateColumns);
    expect(note.content).not.toContain('7700');
    expect(note.content).not.toContain('Fictional Way');
    const logRows = [{ Timestamp: '2026-11-01T10:00:00Z', Name: 'Dana Okafor', MobilePhone: '+44 7700 900123', Event: 'Sign-in' }];
    const logMappings = new Map<string, ColumnMapping>([['Timestamp', 'timestamp'], ['Name', 'identity-name'], ['MobilePhone', 'identity-detail'], ['Event', 'event-title']]);
    const { events } = buildTimelineEvents(logRows, logMappings, 'timeline', 'case', new Set(['MobilePhone']));
    expect(events[0].rawData).not.toContain('7700');
    expect(JSON.parse(events[0].rawData ?? '{}')).toMatchObject({ Name: 'Dana Okafor', Event: 'Sign-in' });
    // By default, private-looking detail columns of rows that make identities are left out too.
    expect(buildTimelineEvents(logRows, logMappings, 'timeline', 'case').events[0].rawData).not.toContain('7700');
    // Without identity columns, an event keeps its whole row, as before.
    const eventsOnly = new Map<string, ColumnMapping>([['Timestamp', 'timestamp'], ['Name', 'actor'], ['MobilePhone', 'ignore'], ['Event', 'event-title']]);
    expect(buildTimelineEvents(logRows, eventsOnly, 'timeline', 'case').events[0].rawData).toContain('7700');
  });
});
