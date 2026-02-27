export interface WordLists {
  adjectives: string[];
  nouns: string[];
}

export interface GeneratedName {
  adjective: string;
  noun: string;
  full: string;
}

export function getStandardLists(): WordLists {
  return {
    adjectives: [
      'CRIMSON', 'COBALT', 'OBSIDIAN', 'SCARLET', 'AZURE', 'IRON', 'SILVER', 'GOLDEN',
      'IVORY', 'ONYX', 'EMERALD', 'AMBER', 'SAPPHIRE', 'RUBY', 'TITANIUM', 'CHROME',
      'ARCTIC', 'THUNDER', 'STORM', 'SHADOW', 'FROST', 'LUNAR', 'SOLAR', 'INFERNO',
      'CYCLONE', 'BLIZZARD', 'TEMPEST', 'MONSOON', 'AVALANCHE', 'VOLCANIC',
      'COVERT', 'SENTINEL', 'PHANTOM', 'STEALTH', 'SILENT', 'SWIFT', 'RAPID', 'BRAVO',
      'DELTA', 'ALPHA', 'OMEGA', 'TACTICAL', 'VALIANT', 'RESOLUTE', 'DEFIANT',
      'APEX', 'CIPHER', 'QUANTUM', 'NEXUS', 'PRIMAL', 'ROGUE', 'VECTOR', 'ZERO',
      'NOBLE', 'EAGLE', 'HYDRA', 'GHOST', 'RAZOR', 'SPECTRE', 'VORTEX', 'ZENITH',
      'DARK', 'BURNING', 'FROZEN', 'ETERNAL', 'ANCIENT', 'BROKEN', 'HOLLOW', 'RISING',
      'FALLING', 'ENDLESS', 'SAVAGE', 'WICKED', 'DIRE', 'GRIM', 'STARK', 'DEEP',
      'BLIND', 'MUTED', 'HEAVY', 'SHARP',
    ],
    nouns: [
      'FALCON', 'VIPER', 'PHOENIX', 'HAWK', 'WOLF', 'PANTHER', 'COBRA', 'RAVEN',
      'TIGER', 'LION', 'JAGUAR', 'SERPENT', 'EAGLE', 'BEAR', 'SCORPION', 'CONDOR',
      'GLACIER', 'SUMMIT', 'CANYON', 'RIDGE', 'CRATER', 'REEF', 'MESA', 'TUNDRA',
      'DELTA', 'HARBOR', 'ATOLL', 'STEPPE', 'FJORD', 'PLATEAU',
      'SHIELD', 'SABRE', 'BASTION', 'HAMMER', 'LANCE', 'DAGGER', 'FORTRESS', 'ANVIL',
      'SPEAR', 'ARROW', 'BLADE', 'FORGE', 'RAMPART', 'CITADEL', 'GAUNTLET',
      'PROTOCOL', 'ENIGMA', 'ORACLE', 'BEACON', 'HORIZON', 'DIRECTIVE', 'MANDATE',
      'OVERTURE', 'DOMINION', 'CRUCIBLE', 'REQUIEM', 'EXODUS', 'TEMPLAR', 'AXIOM',
      'GAMBIT', 'KEYSTONE', 'NEXUS', 'MERIDIAN', 'THRESHOLD', 'VIGIL', 'ECLIPSE',
      'LEGACY', 'TRIDENT', 'SENTRY', 'PRISM', 'WRAITH', 'SPECTER', 'BULWARK',
      'PINNACLE', 'VANGUARD', 'MONOLITH', 'CATALYST', 'ARCHON', 'PARAGON',
    ],
  };
}

export function getChaosLists(): WordLists {
  return {
    adjectives: [
      'CAFFEINATED', 'PASSIVE-AGGRESSIVE', 'UNAUTHORIZED', 'DISCOUNT', 'OVER-ENGINEERED',
      'UNDOCUMENTED', 'DEPRECATED', 'REFACTORED', 'OUTSOURCED', 'LEGACY',
      'MANDATORY', 'TENTATIVE', 'PROVISIONAL', 'QUARTERLY', 'ACTIONABLE',
      'SYNERGISTIC', 'CROSS-FUNCTIONAL', 'ENTERPRISE', 'AGILE', 'DISRUPTIVE',
      'PIVOTED', 'SCALABLE', 'OPTIMIZED', 'LEVERAGED', 'BLOCKCHAIN-ENABLED',
      'AI-POWERED', 'CLOUD-NATIVE', 'DATA-DRIVEN', 'HYPERLOCAL', 'VIRAL',
      'BOTTOM-LINE', 'BLEEDING-EDGE', 'MISSION-CRITICAL', 'FUTURE-PROOF', 'LOW-HANGING',
      'DOUBLE-CLICKED', 'CIRCLE-BACKED', 'RUBBER-STAMPED', 'FAST-TRACKED', 'DEEP-DIVED',
    ],
    nouns: [
      'SPREADSHEET', 'SYNERGY', 'STANDUP', 'DELIVERABLE', 'BANDWIDTH',
      'RETRO', 'BACKLOG', 'BLOCKER', 'PIPELINE', 'SPRINT',
      'ALIGNMENT', 'PARADIGM', 'ECOSYSTEM', 'STAKEHOLDER', 'ROADMAP',
      'THOUGHT-LEADERSHIP', 'VALUE-ADD', 'SWIM-LANE', 'DEEP-DIVE', 'PING',
      'TAKEAWAY', 'BOIL-THE-OCEAN', 'DECK', 'ONE-PAGER', 'CIRCLE-BACK',
      'BANDWIDTH', 'TOUCHPOINT', 'LEARNINGS', 'TIGER-TEAM', 'WAR-ROOM',
      'OFFSITE', 'ALL-HANDS', 'TOWN-HALL', 'FIRESIDE-CHAT', 'LUNCH-AND-LEARN',
      'HAPPY-PATH', 'NORTH-STAR', 'LOW-HANGING-FRUIT', 'QUICK-WIN', 'MOVE-THE-NEEDLE',
    ],
  };
}

export function getUnhingedLists(): WordLists {
  return {
    adjectives: [
      'SUSPICIOUSLY-CALM', 'AGGRESSIVELY-BEIGE', 'SLIGHTLY-HAUNTED', 'SENTIENT', 'INTERDIMENSIONAL',
      'CHAOTICALLY-NEUTRAL', 'OMINOUSLY-CHEERFUL', 'QUESTIONABLY-LEGAL', 'MILDLY-CURSED', 'FERAL',
      'VAGUELY-THREATENING', 'UNHINGED', 'WEAPONIZED', 'MIDNIGHT', 'EXISTENTIAL',
      'SURPRISINGLY-FLAMMABLE', 'SELF-AWARE', 'HAUNTED', 'FORBIDDEN', 'ELDRITCH',
      'OVERCLOCKED', 'TURBO', 'ULTRA-MEGA', 'HYPER-LOCAL', 'TRIPLE-ENCRYPTED',
      'ARTISANAL', 'ORGANIC', 'FREE-RANGE', 'GLUTEN-FREE', 'FAIR-TRADE',
      'SEMI-PERMANENT', 'ACCIDENTALLY-SENTIENT', 'RELUCTANTLY-CONSCIOUS', 'CHRONICALLY-ONLINE', 'TERMINALLY-CHILL',
    ],
    nouns: [
      'RUBBER-DUCK', 'TPS-REPORT', 'DEPLOY-FRIDAY', 'SPAGHETTI-CODE', 'INTERN',
      'DUMPSTER-FIRE', 'MERGE-CONFLICT', 'STACK-OVERFLOW', 'SEGFAULT', 'REGEX',
      'TODO-COMMENT', 'HOTFIX', 'WORKAROUND', 'TECH-DEBT', 'LEGACY-SYSTEM',
      'CLIPBOARD', 'SUDO', 'CRON-JOB', 'DAEMON', 'KERNEL-PANIC',
      'SEMICOLON', 'CALLBACK-HELL', 'RACE-CONDITION', 'DEADLOCK', 'MEMORY-LEAK',
      'DARK-PATTERN', 'COOKIE-BANNER', 'CAPTCHA', 'MODAL-DIALOG', 'LOADING-SPINNER',
      'JIRA-TICKET', 'SLACK-THREAD', 'ZOOM-CALL', 'PULL-REQUEST', 'CODE-REVIEW',
    ],
  };
}

export function getDefconPartyLists(): WordLists {
  return {
    adjectives: [
      'TURBOCHARGED', 'WEAPONS-GRADE', 'INDUSTRIAL-STRENGTH', 'PROFESSIONALLY-UNHINGED',
      'MAXIMUM-OVERDRIVE', 'NUCLEAR-POWERED', 'BATTLE-HARDENED', 'LUDICROUSLY-FAST',
      'CRIMINALLY-UNDERPAID', 'DANGEROUSLY-CAFFEINATED', 'CATASTROPHICALLY-OPTIMISTIC',
      'DIPLOMATICALLY-UNHINGED', 'STRUCTURALLY-QUESTIONABLE', 'COSMICALLY-IRRELEVANT',
      'PROFOUNDLY-UNSERIOUS', 'STRATEGICALLY-CHAOTIC', 'WEAPONIZED-WHOLESOME',
      'CRITICALLY-ACCLAIMED', 'THERMODYNAMICALLY-IMPROBABLE', 'AGGRESSIVELY-MEDIOCRE',
      'SUSPICIOUSLY-PRODUCTIVE', 'LEGALLY-DISTINCT', 'OBJECTIVELY-CURSED', 'PEER-REVIEWED',
      'GALAXY-BRAINED', 'TURBO-ENCABULATED', 'UNREGULATED', 'ARTISAN-CRAFTED',
    ],
    nouns: [
      'CAPYBARA', 'DANGER-NOODLE', 'TRASH-PANDA', 'DRAMA-LLAMA', 'CHAOS-GOBLIN',
      'MURDER-HORNET', 'TRASH-FERRET', 'GREMLIN', 'HONEY-BADGER', 'CHAOS-MONKEY',
      'DOOM-CHICKEN', 'WAR-PENGUIN', 'BATTLE-HAMSTER', 'TACTICAL-CORGI', 'STEALTH-DUCK',
      'FERAL-PIGEON', 'ROGUE-SQUIRREL', 'APEX-GOLDFISH', 'SPEC-OPS-CAT', 'CYBER-POSSUM',
      'PARTY-PARROT', 'DISCO-CRAB', 'NINJA-SLOTH', 'THUNDER-BUNNY', 'TURBO-TORTOISE',
      'YOLO-DOLPHIN', 'PANIC-MOTH', 'CRYPTO-PLATYPUS', 'QUANTUM-HAMSTER', 'MEGA-SHRIMP',
    ],
  };
}

export function generateName(lists: WordLists): GeneratedName {
  const adjective = lists.adjectives[Math.floor(Math.random() * lists.adjectives.length)];
  const noun = lists.nouns[Math.floor(Math.random() * lists.nouns.length)];
  return { adjective, noun, full: `${adjective} ${noun}` };
}

export function getRandomWords(list: string[], count: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(list[Math.floor(Math.random() * list.length)]);
  }
  return result;
}

export type ComedyLevel = 0 | 1 | 2 | 3;

export const COMEDY_LEVELS = [
  { label: 'STANDARD', color: 'gray', bg: 'bg-gray-600', text: 'text-gray-300' },
  { label: 'CHAOS', color: 'amber', bg: 'bg-amber-600', text: 'text-amber-300' },
  { label: 'UNHINGED', color: 'orange', bg: 'bg-orange-600', text: 'text-orange-300' },
  { label: 'DEFCON PARTY', color: 'red', bg: 'bg-red-600', text: 'text-red-300' },
] as const;

export function getListsForLevel(level: ComedyLevel): WordLists {
  switch (level) {
    case 0: return getStandardLists();
    case 1: return getChaosLists();
    case 2: return getUnhingedLists();
    case 3: return getDefconPartyLists();
  }
}
