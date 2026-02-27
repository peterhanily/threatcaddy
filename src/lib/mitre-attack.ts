// Static MITRE ATT&CK Enterprise data — 14 tactics + ~200 top-level techniques
// Sub-techniques (e.g. T1059.001) are NOT in this dataset but are accepted as user input
// and roll up to the parent technique via getParentTechniqueId().

export interface MitreTactic {
  id: string;
  shortName: string;
  name: string;
  order: number;
}

export interface MitreTechnique {
  id: string;
  name: string;
  tactics: string[]; // tactic shortNames
}

export const MITRE_TACTICS: MitreTactic[] = [
  { id: 'TA0043', shortName: 'reconnaissance', name: 'Reconnaissance', order: 0 },
  { id: 'TA0042', shortName: 'resource-development', name: 'Resource Development', order: 1 },
  { id: 'TA0001', shortName: 'initial-access', name: 'Initial Access', order: 2 },
  { id: 'TA0002', shortName: 'execution', name: 'Execution', order: 3 },
  { id: 'TA0003', shortName: 'persistence', name: 'Persistence', order: 4 },
  { id: 'TA0004', shortName: 'privilege-escalation', name: 'Privilege Escalation', order: 5 },
  { id: 'TA0005', shortName: 'defense-evasion', name: 'Defense Evasion', order: 6 },
  { id: 'TA0006', shortName: 'credential-access', name: 'Credential Access', order: 7 },
  { id: 'TA0007', shortName: 'discovery', name: 'Discovery', order: 8 },
  { id: 'TA0008', shortName: 'lateral-movement', name: 'Lateral Movement', order: 9 },
  { id: 'TA0009', shortName: 'collection', name: 'Collection', order: 10 },
  { id: 'TA0011', shortName: 'command-and-control', name: 'Command and Control', order: 11 },
  { id: 'TA0010', shortName: 'exfiltration', name: 'Exfiltration', order: 12 },
  { id: 'TA0040', shortName: 'impact', name: 'Impact', order: 13 },
];

export const MITRE_TECHNIQUES: MitreTechnique[] = [
  // Reconnaissance
  { id: 'T1595', name: 'Active Scanning', tactics: ['reconnaissance'] },
  { id: 'T1592', name: 'Gather Victim Host Information', tactics: ['reconnaissance'] },
  { id: 'T1589', name: 'Gather Victim Identity Information', tactics: ['reconnaissance'] },
  { id: 'T1590', name: 'Gather Victim Network Information', tactics: ['reconnaissance'] },
  { id: 'T1591', name: 'Gather Victim Org Information', tactics: ['reconnaissance'] },
  { id: 'T1598', name: 'Phishing for Information', tactics: ['reconnaissance'] },
  { id: 'T1597', name: 'Search Closed Sources', tactics: ['reconnaissance'] },
  { id: 'T1596', name: 'Search Open Technical Databases', tactics: ['reconnaissance'] },
  { id: 'T1593', name: 'Search Open Websites/Domains', tactics: ['reconnaissance'] },
  { id: 'T1594', name: 'Search Victim-Owned Websites', tactics: ['reconnaissance'] },

  // Resource Development
  { id: 'T1583', name: 'Acquire Infrastructure', tactics: ['resource-development'] },
  { id: 'T1586', name: 'Compromise Accounts', tactics: ['resource-development'] },
  { id: 'T1584', name: 'Compromise Infrastructure', tactics: ['resource-development'] },
  { id: 'T1587', name: 'Develop Capabilities', tactics: ['resource-development'] },
  { id: 'T1585', name: 'Establish Accounts', tactics: ['resource-development'] },
  { id: 'T1588', name: 'Obtain Capabilities', tactics: ['resource-development'] },
  { id: 'T1608', name: 'Stage Capabilities', tactics: ['resource-development'] },

  // Initial Access
  { id: 'T1189', name: 'Drive-by Compromise', tactics: ['initial-access'] },
  { id: 'T1190', name: 'Exploit Public-Facing Application', tactics: ['initial-access'] },
  { id: 'T1133', name: 'External Remote Services', tactics: ['initial-access', 'persistence'] },
  { id: 'T1200', name: 'Hardware Additions', tactics: ['initial-access'] },
  { id: 'T1566', name: 'Phishing', tactics: ['initial-access'] },
  { id: 'T1091', name: 'Replication Through Removable Media', tactics: ['initial-access', 'lateral-movement'] },
  { id: 'T1195', name: 'Supply Chain Compromise', tactics: ['initial-access'] },
  { id: 'T1199', name: 'Trusted Relationship', tactics: ['initial-access'] },
  { id: 'T1078', name: 'Valid Accounts', tactics: ['initial-access', 'persistence', 'privilege-escalation', 'defense-evasion'] },

  // Execution
  { id: 'T1059', name: 'Command and Scripting Interpreter', tactics: ['execution'] },
  { id: 'T1609', name: 'Container Administration Command', tactics: ['execution'] },
  { id: 'T1610', name: 'Deploy Container', tactics: ['execution', 'defense-evasion'] },
  { id: 'T1203', name: 'Exploitation for Client Execution', tactics: ['execution'] },
  { id: 'T1559', name: 'Inter-Process Communication', tactics: ['execution'] },
  { id: 'T1106', name: 'Native API', tactics: ['execution'] },
  { id: 'T1053', name: 'Scheduled Task/Job', tactics: ['execution', 'persistence', 'privilege-escalation'] },
  { id: 'T1129', name: 'Shared Modules', tactics: ['execution'] },
  { id: 'T1072', name: 'Software Deployment Tools', tactics: ['execution', 'lateral-movement'] },
  { id: 'T1569', name: 'System Services', tactics: ['execution'] },
  { id: 'T1204', name: 'User Execution', tactics: ['execution'] },
  { id: 'T1047', name: 'Windows Management Instrumentation', tactics: ['execution'] },

  // Persistence
  { id: 'T1098', name: 'Account Manipulation', tactics: ['persistence', 'privilege-escalation'] },
  { id: 'T1197', name: 'BITS Jobs', tactics: ['persistence', 'defense-evasion'] },
  { id: 'T1547', name: 'Boot or Logon Autostart Execution', tactics: ['persistence', 'privilege-escalation'] },
  { id: 'T1037', name: 'Boot or Logon Initialization Scripts', tactics: ['persistence', 'privilege-escalation'] },
  { id: 'T1176', name: 'Browser Extensions', tactics: ['persistence'] },
  { id: 'T1554', name: 'Compromise Client Software Binary', tactics: ['persistence'] },
  { id: 'T1136', name: 'Create Account', tactics: ['persistence'] },
  { id: 'T1543', name: 'Create or Modify System Process', tactics: ['persistence', 'privilege-escalation'] },
  { id: 'T1546', name: 'Event Triggered Execution', tactics: ['persistence', 'privilege-escalation'] },
  { id: 'T1574', name: 'Hijack Execution Flow', tactics: ['persistence', 'privilege-escalation', 'defense-evasion'] },
  { id: 'T1525', name: 'Implant Internal Image', tactics: ['persistence'] },
  { id: 'T1556', name: 'Modify Authentication Process', tactics: ['persistence', 'credential-access', 'defense-evasion'] },
  { id: 'T1137', name: 'Office Application Startup', tactics: ['persistence'] },
  { id: 'T1542', name: 'Pre-OS Boot', tactics: ['persistence', 'defense-evasion'] },
  { id: 'T1505', name: 'Server Software Component', tactics: ['persistence'] },
  { id: 'T1205', name: 'Traffic Signaling', tactics: ['persistence', 'defense-evasion', 'command-and-control'] },

  // Privilege Escalation
  { id: 'T1548', name: 'Abuse Elevation Control Mechanism', tactics: ['privilege-escalation', 'defense-evasion'] },
  { id: 'T1134', name: 'Access Token Manipulation', tactics: ['privilege-escalation', 'defense-evasion'] },
  { id: 'T1068', name: 'Exploitation for Privilege Escalation', tactics: ['privilege-escalation'] },
  { id: 'T1055', name: 'Process Injection', tactics: ['privilege-escalation', 'defense-evasion'] },

  // Defense Evasion
  { id: 'T1659', name: 'Content Injection', tactics: ['defense-evasion', 'initial-access'] },
  { id: 'T1140', name: 'Deobfuscate/Decode Files or Information', tactics: ['defense-evasion'] },
  { id: 'T1006', name: 'Direct Volume Access', tactics: ['defense-evasion'] },
  { id: 'T1480', name: 'Execution Guardrails', tactics: ['defense-evasion'] },
  { id: 'T1211', name: 'Exploitation for Defense Evasion', tactics: ['defense-evasion'] },
  { id: 'T1222', name: 'File and Directory Permissions Modification', tactics: ['defense-evasion'] },
  { id: 'T1564', name: 'Hide Artifacts', tactics: ['defense-evasion'] },
  { id: 'T1562', name: 'Impair Defenses', tactics: ['defense-evasion'] },
  { id: 'T1070', name: 'Indicator Removal', tactics: ['defense-evasion'] },
  { id: 'T1202', name: 'Indirect Command Execution', tactics: ['defense-evasion'] },
  { id: 'T1036', name: 'Masquerading', tactics: ['defense-evasion'] },
  { id: 'T1556', name: 'Modify Authentication Process', tactics: ['persistence', 'credential-access', 'defense-evasion'] },
  { id: 'T1578', name: 'Modify Cloud Compute Infrastructure', tactics: ['defense-evasion'] },
  { id: 'T1112', name: 'Modify Registry', tactics: ['defense-evasion'] },
  { id: 'T1601', name: 'Modify System Image', tactics: ['defense-evasion'] },
  { id: 'T1599', name: 'Network Boundary Bridging', tactics: ['defense-evasion'] },
  { id: 'T1027', name: 'Obfuscated Files or Information', tactics: ['defense-evasion'] },
  { id: 'T1647', name: 'Plist File Modification', tactics: ['defense-evasion'] },
  { id: 'T1542', name: 'Pre-OS Boot', tactics: ['persistence', 'defense-evasion'] },
  { id: 'T1620', name: 'Reflective Code Loading', tactics: ['defense-evasion'] },
  { id: 'T1207', name: 'Rogue Domain Controller', tactics: ['defense-evasion'] },
  { id: 'T1014', name: 'Rootkit', tactics: ['defense-evasion'] },
  { id: 'T1218', name: 'System Binary Proxy Execution', tactics: ['defense-evasion'] },
  { id: 'T1216', name: 'System Script Proxy Execution', tactics: ['defense-evasion'] },
  { id: 'T1221', name: 'Template Injection', tactics: ['defense-evasion'] },
  { id: 'T1127', name: 'Trusted Developer Utilities Proxy Execution', tactics: ['defense-evasion'] },
  { id: 'T1535', name: 'Unused/Unsupported Cloud Regions', tactics: ['defense-evasion'] },
  { id: 'T1550', name: 'Use Alternate Authentication Material', tactics: ['defense-evasion', 'lateral-movement'] },
  { id: 'T1497', name: 'Virtualization/Sandbox Evasion', tactics: ['defense-evasion', 'discovery'] },
  { id: 'T1600', name: 'Weaken Encryption', tactics: ['defense-evasion'] },
  { id: 'T1220', name: 'XSL Script Processing', tactics: ['defense-evasion'] },

  // Credential Access
  { id: 'T1557', name: 'Adversary-in-the-Middle', tactics: ['credential-access', 'collection'] },
  { id: 'T1110', name: 'Brute Force', tactics: ['credential-access'] },
  { id: 'T1555', name: 'Credentials from Password Stores', tactics: ['credential-access'] },
  { id: 'T1212', name: 'Exploitation for Credential Access', tactics: ['credential-access'] },
  { id: 'T1187', name: 'Forced Authentication', tactics: ['credential-access'] },
  { id: 'T1606', name: 'Forge Web Credentials', tactics: ['credential-access'] },
  { id: 'T1056', name: 'Input Capture', tactics: ['credential-access', 'collection'] },
  { id: 'T1111', name: 'Multi-Factor Authentication Interception', tactics: ['credential-access'] },
  { id: 'T1621', name: 'Multi-Factor Authentication Request Generation', tactics: ['credential-access'] },
  { id: 'T1040', name: 'Network Sniffing', tactics: ['credential-access', 'discovery'] },
  { id: 'T1003', name: 'OS Credential Dumping', tactics: ['credential-access'] },
  { id: 'T1528', name: 'Steal Application Access Token', tactics: ['credential-access'] },
  { id: 'T1649', name: 'Steal or Forge Authentication Certificates', tactics: ['credential-access'] },
  { id: 'T1558', name: 'Steal or Forge Kerberos Tickets', tactics: ['credential-access'] },
  { id: 'T1539', name: 'Steal Web Session Cookie', tactics: ['credential-access'] },
  { id: 'T1552', name: 'Unsecured Credentials', tactics: ['credential-access'] },

  // Discovery
  { id: 'T1087', name: 'Account Discovery', tactics: ['discovery'] },
  { id: 'T1010', name: 'Application Window Discovery', tactics: ['discovery'] },
  { id: 'T1217', name: 'Browser Information Discovery', tactics: ['discovery'] },
  { id: 'T1580', name: 'Cloud Infrastructure Discovery', tactics: ['discovery'] },
  { id: 'T1538', name: 'Cloud Service Dashboard', tactics: ['discovery'] },
  { id: 'T1526', name: 'Cloud Service Discovery', tactics: ['discovery'] },
  { id: 'T1613', name: 'Container and Resource Discovery', tactics: ['discovery'] },
  { id: 'T1622', name: 'Debugger Evasion', tactics: ['discovery', 'defense-evasion'] },
  { id: 'T1482', name: 'Domain Trust Discovery', tactics: ['discovery'] },
  { id: 'T1083', name: 'File and Directory Discovery', tactics: ['discovery'] },
  { id: 'T1615', name: 'Group Policy Discovery', tactics: ['discovery'] },
  { id: 'T1046', name: 'Network Service Discovery', tactics: ['discovery'] },
  { id: 'T1135', name: 'Network Share Discovery', tactics: ['discovery'] },
  { id: 'T1201', name: 'Password Policy Discovery', tactics: ['discovery'] },
  { id: 'T1120', name: 'Peripheral Device Discovery', tactics: ['discovery'] },
  { id: 'T1069', name: 'Permission Groups Discovery', tactics: ['discovery'] },
  { id: 'T1057', name: 'Process Discovery', tactics: ['discovery'] },
  { id: 'T1012', name: 'Query Registry', tactics: ['discovery'] },
  { id: 'T1018', name: 'Remote System Discovery', tactics: ['discovery'] },
  { id: 'T1518', name: 'Software Discovery', tactics: ['discovery'] },
  { id: 'T1082', name: 'System Information Discovery', tactics: ['discovery'] },
  { id: 'T1614', name: 'System Location Discovery', tactics: ['discovery'] },
  { id: 'T1016', name: 'System Network Configuration Discovery', tactics: ['discovery'] },
  { id: 'T1049', name: 'System Network Connections Discovery', tactics: ['discovery'] },
  { id: 'T1033', name: 'System Owner/User Discovery', tactics: ['discovery'] },
  { id: 'T1007', name: 'System Service Discovery', tactics: ['discovery'] },
  { id: 'T1124', name: 'System Time Discovery', tactics: ['discovery'] },

  // Lateral Movement
  { id: 'T1210', name: 'Exploitation of Remote Services', tactics: ['lateral-movement'] },
  { id: 'T1534', name: 'Internal Spearphishing', tactics: ['lateral-movement'] },
  { id: 'T1570', name: 'Lateral Tool Transfer', tactics: ['lateral-movement'] },
  { id: 'T1563', name: 'Remote Service Session Hijacking', tactics: ['lateral-movement'] },
  { id: 'T1021', name: 'Remote Services', tactics: ['lateral-movement'] },
  { id: 'T1080', name: 'Taint Shared Content', tactics: ['lateral-movement'] },

  // Collection
  { id: 'T1560', name: 'Archive Collected Data', tactics: ['collection'] },
  { id: 'T1123', name: 'Audio Capture', tactics: ['collection'] },
  { id: 'T1119', name: 'Automated Collection', tactics: ['collection'] },
  { id: 'T1185', name: 'Browser Session Hijacking', tactics: ['collection'] },
  { id: 'T1115', name: 'Clipboard Data', tactics: ['collection'] },
  { id: 'T1530', name: 'Data from Cloud Storage', tactics: ['collection'] },
  { id: 'T1602', name: 'Data from Configuration Repository', tactics: ['collection'] },
  { id: 'T1213', name: 'Data from Information Repositories', tactics: ['collection'] },
  { id: 'T1005', name: 'Data from Local System', tactics: ['collection'] },
  { id: 'T1039', name: 'Data from Network Shared Drive', tactics: ['collection'] },
  { id: 'T1025', name: 'Data from Removable Media', tactics: ['collection'] },
  { id: 'T1074', name: 'Data Staged', tactics: ['collection'] },
  { id: 'T1114', name: 'Email Collection', tactics: ['collection'] },
  { id: 'T1113', name: 'Screen Capture', tactics: ['collection'] },
  { id: 'T1125', name: 'Video Capture', tactics: ['collection'] },

  // Command and Control
  { id: 'T1071', name: 'Application Layer Protocol', tactics: ['command-and-control'] },
  { id: 'T1092', name: 'Communication Through Removable Media', tactics: ['command-and-control'] },
  { id: 'T1132', name: 'Data Encoding', tactics: ['command-and-control'] },
  { id: 'T1001', name: 'Data Obfuscation', tactics: ['command-and-control'] },
  { id: 'T1568', name: 'Dynamic Resolution', tactics: ['command-and-control'] },
  { id: 'T1573', name: 'Encrypted Channel', tactics: ['command-and-control'] },
  { id: 'T1008', name: 'Fallback Channels', tactics: ['command-and-control'] },
  { id: 'T1105', name: 'Ingress Tool Transfer', tactics: ['command-and-control'] },
  { id: 'T1104', name: 'Multi-Stage Channels', tactics: ['command-and-control'] },
  { id: 'T1095', name: 'Non-Application Layer Protocol', tactics: ['command-and-control'] },
  { id: 'T1571', name: 'Non-Standard Port', tactics: ['command-and-control'] },
  { id: 'T1572', name: 'Protocol Tunneling', tactics: ['command-and-control'] },
  { id: 'T1090', name: 'Proxy', tactics: ['command-and-control'] },
  { id: 'T1219', name: 'Remote Access Software', tactics: ['command-and-control'] },
  { id: 'T1102', name: 'Web Service', tactics: ['command-and-control'] },

  // Exfiltration
  { id: 'T1020', name: 'Automated Exfiltration', tactics: ['exfiltration'] },
  { id: 'T1030', name: 'Data Transfer Size Limits', tactics: ['exfiltration'] },
  { id: 'T1048', name: 'Exfiltration Over Alternative Protocol', tactics: ['exfiltration'] },
  { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactics: ['exfiltration'] },
  { id: 'T1011', name: 'Exfiltration Over Other Network Medium', tactics: ['exfiltration'] },
  { id: 'T1052', name: 'Exfiltration Over Physical Medium', tactics: ['exfiltration'] },
  { id: 'T1567', name: 'Exfiltration Over Web Service', tactics: ['exfiltration'] },
  { id: 'T1029', name: 'Scheduled Transfer', tactics: ['exfiltration'] },
  { id: 'T1537', name: 'Transfer Data to Cloud Account', tactics: ['exfiltration'] },

  // Impact
  { id: 'T1531', name: 'Account Access Removal', tactics: ['impact'] },
  { id: 'T1485', name: 'Data Destruction', tactics: ['impact'] },
  { id: 'T1486', name: 'Data Encrypted for Impact', tactics: ['impact'] },
  { id: 'T1565', name: 'Data Manipulation', tactics: ['impact'] },
  { id: 'T1491', name: 'Defacement', tactics: ['impact'] },
  { id: 'T1561', name: 'Disk Wipe', tactics: ['impact'] },
  { id: 'T1499', name: 'Endpoint Denial of Service', tactics: ['impact'] },
  { id: 'T1495', name: 'Firmware Corruption', tactics: ['impact'] },
  { id: 'T1490', name: 'Inhibit System Recovery', tactics: ['impact'] },
  { id: 'T1498', name: 'Network Denial of Service', tactics: ['impact'] },
  { id: 'T1496', name: 'Resource Hijacking', tactics: ['impact'] },
  { id: 'T1489', name: 'Service Stop', tactics: ['impact'] },
  { id: 'T1529', name: 'System Shutdown/Reboot', tactics: ['impact'] },
];

// Build lookup map for O(1) access
const techniqueMap = new Map<string, MitreTechnique>();
for (const t of MITRE_TECHNIQUES) {
  techniqueMap.set(t.id, t);
}

/** Strip `.NNN` sub-technique suffix → parent ID */
export function getParentTechniqueId(id: string): string {
  const dot = id.indexOf('.');
  return dot === -1 ? id : id.slice(0, dot);
}

/** Look up a technique; sub-technique IDs roll up to parent */
export function lookupTechnique(id: string): MitreTechnique | undefined {
  return techniqueMap.get(id) || techniqueMap.get(getParentTechniqueId(id));
}

/** Return `"T1566: Phishing"` or just the ID if unknown */
export function getTechniqueLabel(id: string): string {
  const t = lookupTechnique(id);
  return t ? `${id}: ${t.name}` : id;
}

/** Filter techniques by ID or name substring (case-insensitive) */
export function searchTechniques(query: string): MitreTechnique[] {
  if (!query) return [];
  const q = query.toLowerCase();
  return MITRE_TECHNIQUES.filter(
    (t) => t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  );
}

// ── Phase 2+3: confidence ranking, Navigator export, CSV export ──

/** Map confidence level strings to numeric ranks (0 = unknown) */
export function confidenceToRank(c: string): number {
  switch (c) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 3;
    case 'confirmed': return 4;
    default: return 0;
  }
}

// ATT&CK Navigator layer format v4.5
export interface NavigatorTechnique {
  techniqueID: string;
  tactic: string;
  score: number;
  comment: string;
  color: string;
  enabled: boolean;
  showSubtechniques: boolean;
}

export interface NavigatorLayer {
  name: string;
  versions: { attack: string; navigator: string; layer: string };
  domain: string;
  description: string;
  sorting: number;
  layout: { layout: string; showID: boolean; showName: boolean; showAggregateScores: boolean; countUnscored: boolean; aggregateFunction: string };
  hideDisabled: boolean;
  techniques: NavigatorTechnique[];
  gradient: { colors: string[]; minValue: number; maxValue: number };
}

interface MitreEvent {
  id: string;
  title: string;
  mitreAttackIds: string[];
  confidence?: string;
  actor?: string;
  timestamp?: number;
}

/** Build an ATT&CK Navigator-compatible JSON layer from events */
export function buildNavigatorLayer(events: MitreEvent[], layerName: string): NavigatorLayer {
  // Aggregate by (parentTechniqueId, tacticShortName)
  const cellMap = new Map<string, { count: number; titles: string[] }>();

  for (const ev of events) {
    for (const rawId of ev.mitreAttackIds) {
      const parentId = getParentTechniqueId(rawId);
      const tech = techniqueMap.get(parentId);
      if (!tech) continue;
      for (const tactic of tech.tactics) {
        const key = `${parentId}|${tactic}`;
        const entry = cellMap.get(key);
        if (entry) {
          entry.count++;
          if (entry.titles.length < 10) entry.titles.push(ev.title);
        } else {
          cellMap.set(key, { count: 1, titles: [ev.title] });
        }
      }
    }
  }

  let maxScore = 1;
  cellMap.forEach((v) => { if (v.count > maxScore) maxScore = v.count; });

  const techniques: NavigatorTechnique[] = [];
  cellMap.forEach((val, key) => {
    const [techId, tactic] = key.split('|');
    techniques.push({
      techniqueID: techId,
      tactic,
      score: val.count,
      comment: val.titles.join('; '),
      color: '',
      enabled: true,
      showSubtechniques: false,
    });
  });

  return {
    name: layerName,
    versions: { attack: '14', navigator: '4.9.5', layer: '4.5' },
    domain: 'enterprise-attack',
    description: `Exported from ThreatCaddy – ${events.length} events`,
    sorting: 3,
    layout: { layout: 'side', showID: true, showName: true, showAggregateScores: false, countUnscored: false, aggregateFunction: 'average' },
    hideDisabled: false,
    techniques,
    gradient: { colors: ['#ffffff', '#ff6666'], minValue: 0, maxValue: maxScore },
  };
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a CSV string mapping techniques to events */
export function buildMitreCSV(events: MitreEvent[]): string {
  const rows: string[] = ['techniqueID,techniqueName,tactic,eventId,eventTitle,confidence,actor,timestamp'];

  for (const ev of events) {
    for (const rawId of ev.mitreAttackIds) {
      const parentId = getParentTechniqueId(rawId);
      const tech = techniqueMap.get(parentId);
      if (!tech) continue;
      for (const tactic of tech.tactics) {
        rows.push([
          csvEscape(rawId),
          csvEscape(tech.name),
          csvEscape(tactic),
          csvEscape(ev.id),
          csvEscape(ev.title),
          csvEscape(ev.confidence || ''),
          csvEscape(ev.actor || ''),
          ev.timestamp ? new Date(ev.timestamp).toISOString() : '',
        ].join(','));
      }
    }
  }

  return rows.join('\n');
}
