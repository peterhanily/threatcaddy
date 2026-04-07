import type { IntegrationTemplate } from '../types/integration-types';
import i18n from '../i18n';

export const BUILTIN_INTEGRATIONS: IntegrationTemplate[] = [
  // ── 1. VirusTotal IP Lookup ──────────────────────────────────────────
  {
    id: 'vt-ip-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.vtIpLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.vtIpLookup.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.vtIpLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.vtIpLookup.config.apiKey.description', { ns: 'integrations' }); },
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
        template: {
          id: '{{ioc.id}}',
          enrichment: { virusTotal: {
            malicious: '{{steps.transform-vt.stats.malicious}}',
            suspicious: '{{steps.transform-vt.stats.suspicious}}',
            country: '{{steps.transform-vt.country}}',
            asOwner: '{{steps.transform-vt.asOwner}}',
            reputation: '{{steps.transform-vt.reputation}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-vt.stats.malicious}} > 5',
        template: {
          id: '{{ioc.id}}',
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
    get name() { return i18n.t('builtin.abuseipdbCheck.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.abuseipdbCheck.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.abuseipdbCheck.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.abuseipdbCheck.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
        secret: true,
      },
      {
        key: 'maxAgeInDays',
        get label() { return i18n.t('builtin.abuseipdbCheck.config.maxAgeInDays.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.abuseipdbCheck.config.maxAgeInDays.description', { ns: 'integrations' }); },
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
        template: {
          id: '{{ioc.id}}',
          enrichment: { abuseIPDB: {
            score: '{{steps.transform-abuseipdb.score}}',
            totalReports: '{{steps.transform-abuseipdb.totalReports}}',
            country: '{{steps.transform-abuseipdb.country}}',
            isp: '{{steps.transform-abuseipdb.isp}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-abuseipdb.score}} > 50',
        template: {
          id: '{{ioc.id}}',
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
    get name() { return i18n.t('builtin.shodanHostInfo.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.shodanHostInfo.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.shodanHostInfo.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.shodanHostInfo.config.apiKey.description', { ns: 'integrations' }); },
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
        url: 'https://api.shodan.io/shodan/host/{{ioc.value}}',
        queryParams: { key: '{{config.apiKey}}' },
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
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { shodan: {
            org: '{{steps.transform-shodan.org}}',
            isp: '{{steps.transform-shodan.isp}}',
            os: '{{steps.transform-shodan.os}}',
            country: '{{steps.transform-shodan.country_name}}',
            ports: '{{steps.transform-shodan.ports}}',
            vulns: '{{steps.transform-shodan.vulns}}',
          }},
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
    get name() { return i18n.t('builtin.slackWebhookNotify.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.slackWebhookNotify.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.slackWebhookNotify.config.webhookUrl.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.slackWebhookNotify.config.webhookUrl.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'https://hooks.slack.com/services/...',
      },
      {
        key: 'channel',
        get label() { return i18n.t('builtin.slackWebhookNotify.config.channel.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.slackWebhookNotify.config.channel.description', { ns: 'integrations' }); },
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
    get name() { return i18n.t('builtin.urlhausLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.urlhausLookup.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.urlhausLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.urlhausLookup.config.apiKey.description', { ns: 'integrations' }); },
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
        template: {
          id: '{{ioc.id}}',
          enrichment: { urlhaus: {
            queryStatus: '{{steps.transform-urlhaus.query_status}}',
            threat: '{{steps.transform-urlhaus.threat}}',
            tags: '{{steps.transform-urlhaus.tags}}',
            reference: '{{steps.transform-urlhaus.urlhaus_reference}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-urlhaus.threat}} != null',
        template: {
          id: '{{ioc.id}}',
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
    get name() { return i18n.t('builtin.urlhausDomainLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.urlhausDomainLookup.description', { ns: 'integrations' }); },
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
        get label() { return i18n.t('builtin.urlhausDomainLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.urlhausDomainLookup.config.apiKey.description', { ns: 'integrations' }); },
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
        template: {
          id: '{{ioc.id}}',
          enrichment: { urlhausDomain: {
            queryStatus: '{{steps.transform-urlhaus.query_status}}',
            urlCount: '{{steps.transform-urlhaus.url_count}}',
            reference: '{{steps.transform-urlhaus.urlhaus_reference}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-urlhaus.url_count}} > 0',
        template: {
          id: '{{ioc.id}}',
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

  // ── 7. Shodan InternetDB (free, no API key) ──────────────────────────
  {
    id: 'shodan-internetdb',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.shodanInternetdb.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.shodanInternetdb.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'globe',
    color: '#D32020',
    category: 'enrichment',
    tags: ['shodan', 'ip', 'ports', 'cve', 'enrichment', 'free'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4'] },
    ],
    configSchema: [],
    steps: [
      {
        id: 'fetch-idb',
        type: 'http',
        label: 'Query Shodan InternetDB',
        method: 'GET',
        url: 'https://internetdb.shodan.io/{{ioc.value}}',
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-idb',
        type: 'transform',
        label: 'Extract InternetDB data',
        input: '{{steps.fetch-idb.response.data}}',
        operations: [
          { op: 'extract', path: 'ports', as: 'ports' },
          { op: 'extract', path: 'cpes', as: 'cpes' },
          { op: 'extract', path: 'hostnames', as: 'hostnames' },
          { op: 'extract', path: 'vulns', as: 'vulns' },
          { op: 'extract', path: 'tags', as: 'tags' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'Shodan InternetDB: {{ioc.value}}',
          body: '## Shodan InternetDB Report\n\n**IP:** {{ioc.value}}\n**Ports:** {{steps.transform-idb.ports}}\n**Hostnames:** {{steps.transform-idb.hostnames}}\n**Tags:** {{steps.transform-idb.tags}}\n\n### Vulnerabilities\n{{steps.transform-idb.vulns}}\n\n### CPEs\n{{steps.transform-idb.cpes}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { shodanInternetDB: {
            ports: '{{steps.transform-idb.ports}}',
            vulns: '{{steps.transform-idb.vulns}}',
            hostnames: '{{steps.transform-idb.hostnames}}',
            tags: '{{steps.transform-idb.tags}}',
            cpes: '{{steps.transform-idb.cpes}}',
          }},
        },
      },
      {
        type: 'display',
        template: {
          title: 'InternetDB: {{ioc.value}}',
          summary: 'Ports: {{steps.transform-idb.ports}} | Vulns: {{steps.transform-idb.vulns}} | Hostnames: {{steps.transform-idb.hostnames}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 120, maxPerDay: 1000 },
    requiredDomains: ['internetdb.shodan.io'],
  },

  // ── 8. VirusTotal Domain Lookup ──────────────────────────────────────
  {
    id: 'vt-domain-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.vtDomainLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.vtDomainLookup.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'shield-check',
    color: '#394EFF',
    category: 'enrichment',
    tags: ['virustotal', 'domain', 'reputation', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['domain'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        get label() { return i18n.t('builtin.vtDomainLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.vtDomainLookup.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
        secret: true,
      },
    ],
    steps: [
      {
        id: 'fetch-vt',
        type: 'http',
        label: 'Fetch VirusTotal domain report',
        method: 'GET',
        url: 'https://www.virustotal.com/api/v3/domains/{{ioc.value}}',
        headers: { 'x-apikey': '{{config.apiKey}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-vt',
        type: 'transform',
        label: 'Extract domain stats',
        input: '{{steps.fetch-vt.response.data}}',
        operations: [
          { op: 'extract', path: 'data.attributes.last_analysis_stats', as: 'stats' },
          { op: 'extract', path: 'data.attributes.registrar', as: 'registrar' },
          { op: 'extract', path: 'data.attributes.reputation', as: 'reputation' },
          { op: 'extract', path: 'data.attributes.categories', as: 'categories' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'VirusTotal Report: {{ioc.value}}',
          body: '## VirusTotal Domain Report\n\n**Domain:** {{ioc.value}}\n**Registrar:** {{steps.transform-vt.registrar}}\n**Reputation:** {{steps.transform-vt.reputation}}\n\n### Analysis Stats\n- Malicious: {{steps.transform-vt.stats.malicious}}\n- Suspicious: {{steps.transform-vt.stats.suspicious}}\n- Harmless: {{steps.transform-vt.stats.harmless}}\n- Undetected: {{steps.transform-vt.stats.undetected}}\n\n### Categories\n{{steps.transform-vt.categories}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { virusTotal: {
            malicious: '{{steps.transform-vt.stats.malicious}}',
            suspicious: '{{steps.transform-vt.stats.suspicious}}',
            registrar: '{{steps.transform-vt.registrar}}',
            reputation: '{{steps.transform-vt.reputation}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-vt.stats.malicious}} > 5',
        template: {
          id: '{{ioc.id}}',
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'VirusTotal: {{ioc.value}}',
          summary: 'Malicious: {{steps.transform-vt.stats.malicious}} | Registrar: {{steps.transform-vt.registrar}} | Reputation: {{steps.transform-vt.reputation}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['www.virustotal.com'],
  },

  // ── 9. VirusTotal Hash Lookup ────────────────────────────────────────
  {
    id: 'vt-hash-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.vtHashLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.vtHashLookup.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'shield-check',
    color: '#394EFF',
    category: 'enrichment',
    tags: ['virustotal', 'hash', 'malware', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['md5', 'sha1', 'sha256'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        get label() { return i18n.t('builtin.vtHashLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.vtHashLookup.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
        secret: true,
      },
    ],
    steps: [
      {
        id: 'fetch-vt',
        type: 'http',
        label: 'Fetch VirusTotal file report',
        method: 'GET',
        url: 'https://www.virustotal.com/api/v3/files/{{ioc.value}}',
        headers: { 'x-apikey': '{{config.apiKey}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-vt',
        type: 'transform',
        label: 'Extract file stats',
        input: '{{steps.fetch-vt.response.data}}',
        operations: [
          { op: 'extract', path: 'data.attributes.last_analysis_stats', as: 'stats' },
          { op: 'extract', path: 'data.attributes.meaningful_name', as: 'fileName' },
          { op: 'extract', path: 'data.attributes.type_description', as: 'fileType' },
          { op: 'extract', path: 'data.attributes.size', as: 'fileSize' },
          { op: 'extract', path: 'data.attributes.popular_threat_classification', as: 'threatClass' },
          { op: 'extract', path: 'data.attributes.tags', as: 'tags' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'VirusTotal Report: {{ioc.value}}',
          body: '## VirusTotal File Report\n\n**Hash:** {{ioc.value}}\n**File Name:** {{steps.transform-vt.fileName}}\n**File Type:** {{steps.transform-vt.fileType}}\n**Size:** {{steps.transform-vt.fileSize}} bytes\n**Tags:** {{steps.transform-vt.tags}}\n\n### Analysis Stats\n- Malicious: {{steps.transform-vt.stats.malicious}}\n- Suspicious: {{steps.transform-vt.stats.suspicious}}\n- Harmless: {{steps.transform-vt.stats.harmless}}\n- Undetected: {{steps.transform-vt.stats.undetected}}\n\n### Threat Classification\n{{steps.transform-vt.threatClass}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { virusTotal: {
            malicious: '{{steps.transform-vt.stats.malicious}}',
            suspicious: '{{steps.transform-vt.stats.suspicious}}',
            fileName: '{{steps.transform-vt.fileName}}',
            fileType: '{{steps.transform-vt.fileType}}',
            fileSize: '{{steps.transform-vt.fileSize}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-vt.stats.malicious}} > 3',
        template: {
          id: '{{ioc.id}}',
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'VirusTotal: {{ioc.value}}',
          summary: 'Malicious: {{steps.transform-vt.stats.malicious}} | Type: {{steps.transform-vt.fileType}} | Name: {{steps.transform-vt.fileName}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['www.virustotal.com'],
  },

  // ── 10. ThreatFox IOC Search ─────────────────────────────────────────
  {
    id: 'threatfox-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.threatfoxLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.threatfoxLookup.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'bug',
    color: '#f59e0b',
    category: 'enrichment',
    tags: ['threatfox', 'malware', 'c2', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4', 'domain', 'url', 'md5', 'sha256'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        get label() { return i18n.t('builtin.threatfoxLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.threatfoxLookup.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
      },
    ],
    steps: [
      {
        id: 'fetch-tf',
        type: 'http',
        label: 'Query ThreatFox',
        method: 'POST',
        url: 'https://threatfox-api.abuse.ch/api/v1/',
        headers: { 'Auth-Key': '{{config.apiKey}}' },
        body: { query: 'search_ioc', search_term: '{{ioc.value}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-tf',
        type: 'transform',
        label: 'Extract ThreatFox data',
        input: '{{steps.fetch-tf.response.data}}',
        operations: [
          { op: 'extract', path: 'query_status', as: 'query_status' },
          { op: 'extract', path: 'data', as: 'matches' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'ThreatFox Report: {{ioc.value}}',
          body: '## ThreatFox IOC Report\n\n**IOC:** {{ioc.value}}\n**Status:** {{steps.transform-tf.query_status}}\n\n### Matches\n{{steps.transform-tf.matches}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { threatFox: {
            queryStatus: '{{steps.transform-tf.query_status}}',
            matches: '{{steps.transform-tf.matches}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-tf.query_status}} == ok',
        template: {
          id: '{{ioc.id}}',
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'ThreatFox: {{ioc.value}}',
          summary: 'Status: {{steps.transform-tf.query_status}} | Matches: {{steps.transform-tf.matches}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['threatfox-api.abuse.ch'],
  },

  // ── 11. MalwareBazaar Hash Lookup ────────────────────────────────────
  {
    id: 'malwarebazaar-lookup',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.malwarebazaarLookup.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.malwarebazaarLookup.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'file-warning',
    color: '#dc2626',
    category: 'enrichment',
    tags: ['malwarebazaar', 'hash', 'malware', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['md5', 'sha1', 'sha256'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        get label() { return i18n.t('builtin.malwarebazaarLookup.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.malwarebazaarLookup.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
      },
    ],
    steps: [
      {
        id: 'fetch-mb',
        type: 'http',
        label: 'Query MalwareBazaar',
        method: 'POST',
        url: 'https://mb-api.abuse.ch/api/v1/',
        headers: { 'Auth-Key': '{{config.apiKey}}' },
        contentType: 'form',
        body: { query: 'get_info', hash: '{{ioc.value}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-mb',
        type: 'transform',
        label: 'Extract MalwareBazaar data',
        input: '{{steps.fetch-mb.response.data}}',
        operations: [
          { op: 'extract', path: 'query_status', as: 'query_status' },
          { op: 'extract', path: 'data', as: 'samples' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'MalwareBazaar Report: {{ioc.value}}',
          body: '## MalwareBazaar Report\n\n**Hash:** {{ioc.value}}\n**Status:** {{steps.transform-mb.query_status}}\n\n### Sample Data\n{{steps.transform-mb.samples}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { malwareBazaar: {
            queryStatus: '{{steps.transform-mb.query_status}}',
            samples: '{{steps.transform-mb.samples}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-mb.query_status}} == ok',
        template: {
          id: '{{ioc.id}}',
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'MalwareBazaar: {{ioc.value}}',
          summary: 'Status: {{steps.transform-mb.query_status}} | Results: {{steps.transform-mb.samples}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 60, maxPerDay: 500 },
    requiredDomains: ['mb-api.abuse.ch'],
  },

  // ── 12. GreyNoise Community ──────────────────────────────────────────
  {
    id: 'greynoise-community',
    schemaVersion: '1.0',
    version: '1.0.0',
    get name() { return i18n.t('builtin.greynoiseCommunity.name', { ns: 'integrations' }); },
    get description() { return i18n.t('builtin.greynoiseCommunity.description', { ns: 'integrations' }); },
    author: 'ThreatCaddy',
    icon: 'radio',
    color: '#10b981',
    category: 'enrichment',
    tags: ['greynoise', 'ip', 'noise', 'reputation', 'enrichment'],
    source: 'builtin',
    createdAt: 0,
    updatedAt: 0,
    triggers: [
      { type: 'manual', iocTypes: ['ipv4'] },
    ],
    configSchema: [
      {
        key: 'apiKey',
        get label() { return i18n.t('builtin.greynoiseCommunity.config.apiKey.label', { ns: 'integrations' }); },
        get description() { return i18n.t('builtin.greynoiseCommunity.config.apiKey.description', { ns: 'integrations' }); },
        type: 'password',
        required: true,
      },
    ],
    steps: [
      {
        id: 'fetch-gn',
        type: 'http',
        label: 'Query GreyNoise Community',
        method: 'GET',
        url: 'https://api.greynoise.io/v3/community/{{ioc.value}}',
        headers: { key: '{{config.apiKey}}' },
        responseType: 'json',
        retry: { maxRetries: 2, retryOn: [429, 500, 502, 503], backoffMs: 2000 },
      },
      {
        id: 'transform-gn',
        type: 'transform',
        label: 'Extract GreyNoise data',
        input: '{{steps.fetch-gn.response.data}}',
        operations: [
          { op: 'extract', path: 'classification', as: 'classification' },
          { op: 'extract', path: 'noise', as: 'noise' },
          { op: 'extract', path: 'riot', as: 'riot' },
          { op: 'extract', path: 'name', as: 'name' },
          { op: 'extract', path: 'last_seen', as: 'lastSeen' },
          { op: 'extract', path: 'message', as: 'message' },
        ],
      },
    ],
    outputs: [
      {
        type: 'create-note',
        template: {
          title: 'GreyNoise Report: {{ioc.value}}',
          body: '## GreyNoise Community Report\n\n**IP:** {{ioc.value}}\n**Classification:** {{steps.transform-gn.classification}}\n**Name:** {{steps.transform-gn.name}}\n**Noise:** {{steps.transform-gn.noise}}\n**RIOT:** {{steps.transform-gn.riot}}\n**Last Seen:** {{steps.transform-gn.lastSeen}}\n**Message:** {{steps.transform-gn.message}}',
        },
      },
      {
        type: 'update-ioc',
        template: {
          id: '{{ioc.id}}',
          enrichment: { greyNoise: {
            classification: '{{steps.transform-gn.classification}}',
            noise: '{{steps.transform-gn.noise}}',
            riot: '{{steps.transform-gn.riot}}',
            name: '{{steps.transform-gn.name}}',
            lastSeen: '{{steps.transform-gn.lastSeen}}',
          }},
        },
      },
      {
        type: 'update-ioc',
        condition: '{{steps.transform-gn.classification}} == malicious',
        template: {
          id: '{{ioc.id}}',
          iocStatus: 'malicious',
          confidence: 'high',
        },
      },
      {
        type: 'display',
        template: {
          title: 'GreyNoise: {{ioc.value}}',
          summary: '{{steps.transform-gn.classification}} | Noise: {{steps.transform-gn.noise}} | RIOT: {{steps.transform-gn.riot}} | {{steps.transform-gn.name}}',
        },
      },
    ],
    rateLimit: { maxPerHour: 50, maxPerDay: 100 },
    requiredDomains: ['api.greynoise.io'],
  },
];
