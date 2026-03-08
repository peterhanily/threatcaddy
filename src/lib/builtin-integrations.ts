import type { IntegrationTemplate } from '../types/integration-types';

export const BUILTIN_INTEGRATIONS: IntegrationTemplate[] = [
  // ── 1. VirusTotal IP Lookup ──────────────────────────────────────────
  {
    id: 'vt-ip-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'VirusTotal IP Lookup',
    description: 'Look up an IP address on VirusTotal to retrieve reputation, geolocation, and analysis statistics.',
    author: 'ThreatCaddy',
    icon: 'shield-check',
    color: '#394EFF',
    category: 'enrichment',
    tags: ['virustotal', 'ip', 'reputation', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4', 'ipv6'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Your VirusTotal API key',
        type: 'password',
        required: true,
        secret: true,
      },
    ],
    steps: [
      {
        id: 'fetch-vt',
        type: 'http',
        label: 'Fetch VirusTotal IP report',
        method: 'GET',
        url: 'https://www.virustotal.com/api/v3/ip_addresses/{{ioc.value}}',
        headers: { 'x-apikey': '{{config.apiKey}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-vt',
        type: 'transform',
        label: 'Extract analysis stats',
        input: '{{steps.fetch-vt.response.data}}',
        operations: [
          { op: 'extract', path: 'data.attributes.last_analysis_stats', as: 'stats' },
          { op: 'extract', path: 'data.attributes.country', as: 'country' },
          { op: 'extract', path: 'data.attributes.as_owner', as: 'asOwner' },
          { op: 'extract', path: 'data.attributes.reputation', as: 'reputation' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'VirusTotal Report: {{ioc.value}}',
          body: '## VirusTotal IP Report\n\n**IP:** {{ioc.value}}\n**Country:** {{steps.transform-vt.country}}\n**AS Owner:** {{steps.transform-vt.asOwner}}\n**Reputation:** {{steps.transform-vt.reputation}}\n\n### Analysis Stats\n- Malicious: {{steps.transform-vt.stats.malicious}}\n- Suspicious: {{steps.transform-vt.stats.suspicious}}\n- Harmless: {{steps.transform-vt.stats.harmless}}\n- Undetected: {{steps.transform-vt.stats.undetected}}',
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-vt.stats.malicious}} > 5',
        template: {
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'VirusTotal: {{ioc.value}}',
          summary: 'Malicious: {{steps.transform-vt.stats.malicious}} | Country: {{steps.transform-vt.country}} | AS: {{steps.transform-vt.asOwner}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['www.virustotal.com'],
  },

  // ── 2. AbuseIPDB Check ───────────────────────────────────────────────
  {
    id: 'abuseipdb-check',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'AbuseIPDB Check',
    description: 'Check an IP address against the AbuseIPDB database for abuse reports and confidence scoring.',
    author: 'ThreatCaddy',
    icon: 'shield-alert',
    color: '#f97316',
    category: 'enrichment',
    tags: ['abuseipdb', 'ip', 'abuse', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4', 'ipv6'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Your AbuseIPDB API key',
        type: 'password',
        required: true,
        secret: true,
      },
      {
        key: 'maxAgeInDays',
        label: 'Max Age (days)',
        description: 'Maximum age of reports to include',
        type: 'number',
        required: false,
        default: 90,
      },
    ],
    steps: [
      {
        id: 'fetch-abuseipdb',
        type: 'http',
        label: 'Query AbuseIPDB',
        method: 'GET',
        url: 'https://api.abuseipdb.com/api/v2/check',
        headers: { Key: '{{config.apiKey}}', Accept: 'application/json' },
        queryParams: {
          ipAddress: '{{ioc.value}}',
          maxAgeInDays: '{{config.maxAgeInDays}}',
          verbose: 'true',
        },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-abuseipdb',
        type: 'transform',
        label: 'Extract abuse data',
        input: '{{steps.fetch-abuseipdb.response.data}}',
        operations: [
          { op: 'extract', path: 'data.abuseConfidenceScore', as: 'score' },
          { op: 'extract', path: 'data.totalReports', as: 'totalReports' },
          { op: 'extract', path: 'data.countryCode', as: 'country' },
          { op: 'extract', path: 'data.isp', as: 'isp' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'AbuseIPDB Report: {{ioc.value}}',
          body: '## AbuseIPDB Report\n\n**IP:** {{ioc.value}}\n**Abuse Confidence Score:** {{steps.transform-abuseipdb.score}}%\n**Total Reports:** {{steps.transform-abuseipdb.totalReports}}\n**Country:** {{steps.transform-abuseipdb.country}}\n**ISP:** {{steps.transform-abuseipdb.isp}}',
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-abuseipdb.score}} > 50',
        template: {
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'AbuseIPDB: {{ioc.value}}',
          summary: 'Score: {{steps.transform-abuseipdb.score}}% | Reports: {{steps.transform-abuseipdb.totalReports}} | ISP: {{steps.transform-abuseipdb.isp}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 1000 },
    requiredDomains: ['api.abuseipdb.com'],
  },

  // ── 3. Shodan Host Info ──────────────────────────────────────────────
  {
    id: 'shodan-host-info',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'Shodan Host Info',
    description: 'Retrieve host information from Shodan including open ports, vulnerabilities, and organization details.',
    author: 'ThreatCaddy',
    icon: 'globe',
    color: '#10b981',
    category: 'enrichment',
    tags: ['shodan', 'ip', 'ports', 'vulnerabilities', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Your Shodan API key',
        type: 'password',
        required: true,
        secret: true,
      },
    ],
    steps: [
      {
        id: 'fetch-shodan',
        type: 'http',
        label: 'Fetch Shodan host info',
        method: 'GET',
        url: 'https://api.shodan.io/shodan/host/{{ioc.value}}?key={{config.apiKey}}',
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-shodan',
        type: 'transform',
        label: 'Extract host details',
        input: '{{steps.fetch-shodan.response.data}}',
        operations: [
          { op: 'extract', path: 'ports', as: 'ports' },
          { op: 'extract', path: 'vulns', as: 'vulns' },
          { op: 'extract', path: 'org', as: 'org' },
          { op: 'extract', path: 'os', as: 'os' },
          { op: 'extract', path: 'isp', as: 'isp' },
          { op: 'extract', path: 'country_name', as: 'country_name' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'Shodan Report: {{ioc.value}}',
          body: '## Shodan Host Report\n\n**IP:** {{ioc.value}}\n**Organization:** {{steps.transform-shodan.org}}\n**ISP:** {{steps.transform-shodan.isp}}\n**OS:** {{steps.transform-shodan.os}}\n**Country:** {{steps.transform-shodan.country_name}}\n\n### Open Ports\n{{steps.transform-shodan.ports}}\n\n### Vulnerabilities\n{{steps.transform-shodan.vulns}}',
        },
      },
      {
        type: 'display',
        template: {
          title: 'Shodan: {{ioc.value}}',
          summary: 'Org: {{steps.transform-shodan.org}} | Ports: {{steps.transform-shodan.ports}} | Vulns: {{steps.transform-shodan.vulns}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 30, maxPerDay: 200 },
    requiredDomains: ['api.shodan.io'],
  },

  // ── 4. Slack Webhook Notification ────────────────────────────────────
  {
    id: 'slack-webhook-notify',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'Slack Webhook Notification',
    description: 'Send IOC alerts to a Slack channel via an incoming webhook with rich Block Kit formatting.',
    author: 'ThreatCaddy',
    icon: 'message-square',
    color: '#4A154B',
    category: 'notification',
    tags: ['slack', 'notification', 'webhook', 'alerting'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      {
        type: 'manual',
        iocTypes: ['ipv4', 'ipv6', 'domain', 'url', 'email', 'md5', 'sha1', 'sha256', 'cve', 'mitre-attack', 'yara-rule', 'sigma-rule', 'file-path'],
      },
      {
        type: 'on-entity-create',
        entityTables: ['standaloneIOCs'],
      },
    ],
    configSchema: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        description: 'Slack incoming webhook URL',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'https://hooks.slack.com/services/...',
      },
      {
        key: 'channel',
        label: 'Channel Override',
        description: 'Optional channel to post to (overrides webhook default)',
        type: 'string',
        required: false,
        placeholder: '#threat-intel',
      },
    ],
    steps: [
      {
        id: 'post-slack',
        type: 'http',
        label: 'Send Slack notification',
        method: 'POST',
        url: '{{config.webhookUrl}}',
        headers: { 'Content-Type': 'application/json' },
        contentType: 'json',
        body: {
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: 'ThreatCaddy IOC Alert', emoji: true },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*Type:*\n{{ioc.type}}' },
                { type: 'mrkdwn', text: '*Value:*\n`{{ioc.value}}`' },
                { type: 'mrkdwn', text: '*Confidence:*\n{{ioc.confidence}}' },
                { type: 'mrkdwn', text: '*Status:*\n{{ioc.iocStatus}}' },
              ],
            },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: 'Sent from ThreatCaddy' },
              ],
            },
          ],
        },
        responseType: 'text',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
    ],
    outputs: [
      {
        type: 'display',
        template: {
          title: 'Slack Notification Sent',
          summary: 'IOC {{ioc.value}} ({{ioc.type}}) posted to Slack.',
        },
      },
    ],
    rateLimit: { maxPerHour: 100, maxPerDay: 500 },
    requiredDomains: ['hooks.slack.com'],
  },

  // ── 5. URLhaus URL Lookup ────────────────────────────────────────────
  {
    id: 'urlhaus-lookup',
    schemaVersion: '1.0',
    version: '1.1.0',
    name: 'URLhaus URL Lookup',
    description: 'Look up a URL on URLhaus (abuse.ch) for known malware distribution activity. Requires a free API key from auth.abuse.ch.',
    author: 'ThreatCaddy',
    icon: 'link',
    color: '#ef4444',
    category: 'enrichment',
    tags: ['urlhaus', 'url', 'malware', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['url'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        label: 'Auth Key',
        description: 'Your abuse.ch Auth Key (free at auth.abuse.ch)',
        type: 'password',
        required: true,
      },
    ],
    steps: [
      {
        id: 'fetch-urlhaus',
        type: 'http',
        label: 'Query URLhaus',
        method: 'POST',
        url: 'https://urlhaus-api.abuse.ch/v1/url/',
        headers: { 'Auth-Key': '{{config.apiKey}}' },
        contentType: 'form',
        body: { url: '{{ioc.value}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-urlhaus',
        type: 'transform',
        label: 'Extract URLhaus data',
        input: '{{steps.fetch-urlhaus.response.data}}',
        operations: [
          { op: 'extract', path: 'query_status', as: 'query_status' },
          { op: 'extract', path: 'urlhaus_reference', as: 'urlhaus_reference' },
          { op: 'extract', path: 'threat', as: 'threat' },
          { op: 'extract', path: 'blacklists', as: 'blacklists' },
          { op: 'extract', path: 'tags', as: 'tags' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'URLhaus Report: {{ioc.value}}',
          body: '## URLhaus Report\n\n**URL:** {{ioc.value}}\n**Status:** {{steps.transform-urlhaus.query_status}}\n**Threat:** {{steps.transform-urlhaus.threat}}\n**Reference:** {{steps.transform-urlhaus.urlhaus_reference}}\n**Tags:** {{steps.transform-urlhaus.tags}}\n\n### Blacklists\n{{steps.transform-urlhaus.blacklists}}',
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-urlhaus.threat}} != null',
        template: {
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'URLhaus: {{ioc.value}}',
          summary: 'Status: {{steps.transform-urlhaus.query_status}} | Threat: {{steps.transform-urlhaus.threat}} | Tags: {{steps.transform-urlhaus.tags}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['urlhaus-api.abuse.ch'],
  },

  // ── 6. URLhaus Domain Lookup ───────────────────────────────────────
  {
    id: 'urlhaus-domain-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    name: 'URLhaus Domain Lookup',
    description: 'Look up a domain on URLhaus (abuse.ch) for known malware distribution URLs. Requires a free API key from auth.abuse.ch.',
    author: 'ThreatCaddy',
    icon: 'link',
    color: '#ef4444',
    category: 'enrichment',
    tags: ['urlhaus', 'domain', 'malware', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['domain'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        label: 'Auth Key',
        description: 'Your abuse.ch Auth Key (free at auth.abuse.ch)',
        type: 'password',
        required: true,
      },
    ],
    steps: [
      {
        id: 'fetch-urlhaus',
        type: 'http',
        label: 'Query URLhaus host',
        method: 'POST',
        url: 'https://urlhaus-api.abuse.ch/v1/host/',
        headers: { 'Auth-Key': '{{config.apiKey}}' },
        contentType: 'form',
        body: { host: '{{ioc.value}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-urlhaus',
        type: 'transform',
        label: 'Extract URLhaus data',
        input: '{{steps.fetch-urlhaus.response.data}}',
        operations: [
          { op: 'extract', path: 'query_status', as: 'query_status' },
          { op: 'extract', path: 'urlhaus_reference', as: 'urlhaus_reference' },
          { op: 'extract', path: 'urls', as: 'urls' },
          { op: 'extract', path: 'blacklists', as: 'blacklists' },
          { op: 'extract', path: 'url_count', as: 'url_count' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'URLhaus Report: {{ioc.value}}',
          body: '## URLhaus Domain Report\n\n**Domain:** {{ioc.value}}\n**Status:** {{steps.transform-urlhaus.query_status}}\n**URLs Found:** {{steps.transform-urlhaus.url_count}}\n**Reference:** {{steps.transform-urlhaus.urlhaus_reference}}\n\n### Blacklists\n{{steps.transform-urlhaus.blacklists}}',
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-urlhaus.url_count}} > 0',
        template: {
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'URLhaus: {{ioc.value}}',
          summary: 'Status: {{steps.transform-urlhaus.query_status}} | URLs: {{steps.transform-urlhaus.url_count}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['urlhaus-api.abuse.ch'],
  },
];
