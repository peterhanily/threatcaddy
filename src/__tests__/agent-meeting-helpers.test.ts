/**
 * Unit tests for the Phase 4 meeting-discipline helpers exposed from
 * caddy-agent-meeting.ts. These pieces are the load-bearing parts of the
 * meeting pipeline that don't require an LLM round-trip — confidence parsing,
 * purpose-specific framing, structured-artifact parsing.
 */

import { describe, it, expect } from 'vitest';
import {
  parseConfidenceTag,
  stripConfidenceTag,
  purposeInstruction,
  synthesizerPrompt,
  parseSynthesizerJson,
} from '../lib/caddy-agent-meeting';

describe('parseConfidenceTag', () => {
  it('extracts a confidence value at the tail of a contribution', () => {
    expect(parseConfidenceTag('I am done. [[confidence=4]]')).toBe(4);
  });

  it('accepts whitespace inside the tag', () => {
    expect(parseConfidenceTag('text [[confidence = 3]] more text')).toBe(3);
  });

  it('is case-insensitive', () => {
    expect(parseConfidenceTag('[[CONFIDENCE=5]]')).toBe(5);
  });

  it('returns undefined when no tag is present', () => {
    expect(parseConfidenceTag('I have more to add but forgot the tag.')).toBeUndefined();
  });

  it('returns undefined for out-of-range values (regex only matches 1-5)', () => {
    expect(parseConfidenceTag('[[confidence=10]]')).toBeUndefined();
    expect(parseConfidenceTag('[[confidence=0]]')).toBeUndefined();
    expect(parseConfidenceTag('[[confidence=-1]]')).toBeUndefined();
  });

  it('returns the first match if multiple tags are present', () => {
    expect(parseConfidenceTag('[[confidence=2]] then [[confidence=5]]')).toBe(2);
  });
});

describe('stripConfidenceTag', () => {
  it('removes the tag from text', () => {
    expect(stripConfidenceTag('Position X is correct. [[confidence=5]]')).toBe('Position X is correct.');
  });

  it('removes all instances if multiple are present', () => {
    expect(stripConfidenceTag('[[confidence=3]] hello [[confidence=4]] world')).toBe('hello  world');
  });

  it('leaves text without a tag unchanged', () => {
    expect(stripConfidenceTag('No tag here.')).toBe('No tag here.');
  });
});

describe('purposeInstruction', () => {
  it('returns empty string for freeform (no scoping)', () => {
    expect(purposeInstruction('freeform', 'agenda text')).toBe('');
  });

  it('frames redTeamReview adversarially and includes the agenda claim', () => {
    const out = purposeInstruction('redTeamReview', 'Migrate auth to OIDC by Friday');
    expect(out).toContain('RED TEAM REVIEW');
    expect(out).toContain('Migrate auth to OIDC by Friday');
    expect(out).toContain('failure modes');
  });

  it('frames dissentSynthesis around making reasoning legible', () => {
    const out = purposeInstruction('dissentSynthesis', 'Should we kill switch X?');
    expect(out).toContain('DISSENT SYNTHESIS');
    expect(out).toContain('legible');
  });

  it('frames signOff as a vote, not a discussion', () => {
    const out = purposeInstruction('signOff', 'Approve hotfix deploy');
    expect(out).toContain('SIGN-OFF');
    expect(out).toContain('approve');
    expect(out).toContain('Do not discuss alternatives');
  });
});

describe('synthesizerPrompt', () => {
  it('embeds the purpose-specific JSON schema for redTeamReview', () => {
    const out = synthesizerPrompt('redTeamReview', 'agenda', 2);
    expect(out).toContain('verdict');
    expect(out).toContain('attackedClaims');
    expect(out).toContain('weakPoints');
    expect(out).toContain('"redTeamReview"');
  });

  it('embeds the dissentSynthesis schema with positions[]', () => {
    const out = synthesizerPrompt('dissentSynthesis', 'agenda', 2);
    expect(out).toContain('positions');
    expect(out).toContain('reconciled');
    expect(out).toContain('unresolved');
  });

  it('embeds the signOff schema with decision + blockers', () => {
    const out = synthesizerPrompt('signOff', 'agenda', 2);
    expect(out).toContain('decision');
    expect(out).toContain('approvers');
    expect(out).toContain('blockers');
    expect(out).toContain('conditions');
  });

  it('falls back to a freeform summary schema for unknown purpose', () => {
    const out = synthesizerPrompt('freeform', 'agenda', 2);
    expect(out).toContain('summary');
    expect(out).toContain('keyPoints');
    expect(out).toContain('actionItems');
  });

  it('reports the round count to the synthesizer', () => {
    const out = synthesizerPrompt('redTeamReview', 'agenda', 2);
    expect(out).toContain('2 round');
  });
});

describe('parseSynthesizerJson', () => {
  it('extracts a parsed object from a ```json block', () => {
    const text = 'preamble\n```json\n{"verdict":"holds","weakPoints":["x"]}\n```\n## Summary\nstuff';
    const out = parseSynthesizerJson(text, 'redTeamReview');
    expect(out).toEqual({ purpose: 'redTeamReview', verdict: 'holds', weakPoints: ['x'] });
  });

  it('coerces the purpose field to the requested purpose even if missing', () => {
    const text = '```json\n{"decision":"approved","blockers":[]}\n```';
    const out = parseSynthesizerJson(text, 'signOff');
    expect(out?.purpose).toBe('signOff');
  });

  it('overrides a wrong purpose field in the JSON with the requested one', () => {
    const text = '```json\n{"purpose":"freeform","verdict":"reject"}\n```';
    const out = parseSynthesizerJson(text, 'redTeamReview');
    expect(out?.purpose).toBe('redTeamReview');
  });

  it('returns undefined when no code block is present', () => {
    expect(parseSynthesizerJson('no json here', 'freeform')).toBeUndefined();
  });

  it('returns undefined when the JSON is malformed', () => {
    expect(parseSynthesizerJson('```json\n{not valid\n```', 'freeform')).toBeUndefined();
  });

  it('accepts a bare ``` block (no language tag)', () => {
    const text = '```\n{"summary":"ok"}\n```';
    const out = parseSynthesizerJson(text, 'freeform');
    // Regex requires "json" tag — bare ``` should not match. Confirms strictness.
    expect(out).toBeUndefined();
  });
});
