import { useMemo } from 'react';
import { MITRE_TACTICS, MITRE_TECHNIQUES, getParentTechniqueId } from '../../lib/mitre-attack';
import type { TimelineEvent } from '../../types';

interface MitreReportProps {
  events: TimelineEvent[];
}

export function MitreReport({ events }: MitreReportProps) {
  const { tacticCounts, maxTacticCount, actorTTPs, techniqueCoverage } = useMemo(() => {
    // Count techniques per tactic
    const techByTactic = new Map<string, Set<string>>();
    // Actor → Set<techniqueId>
    const actorTechs = new Map<string, Set<string>>();
    const allTechniques = new Set<string>();

    for (const ev of events) {
      for (const rawId of ev.mitreAttackIds) {
        const parentId = getParentTechniqueId(rawId);
        allTechniques.add(parentId);

        const tech = MITRE_TECHNIQUES.find((t) => t.id === parentId);
        if (tech) {
          for (const tactic of tech.tactics) {
            let s = techByTactic.get(tactic);
            if (!s) { s = new Set(); techByTactic.set(tactic, s); }
            s.add(parentId);
          }
        }

        if (ev.actor) {
          let s = actorTechs.get(ev.actor);
          if (!s) { s = new Set(); actorTechs.set(ev.actor, s); }
          s.add(parentId);
        }
      }
    }

    const counts = MITRE_TACTICS.map((t) => ({
      tactic: t,
      count: techByTactic.get(t.shortName)?.size || 0,
    }));
    const maxC = Math.max(1, ...counts.map((c) => c.count));

    // Sort actors by technique count descending
    const actors = Array.from(actorTechs.entries())
      .map(([name, techs]) => ({
        name,
        techniques: Array.from(techs).map((id) => {
          const t = MITRE_TECHNIQUES.find((mt) => mt.id === id);
          return { id, name: t?.name || id };
        }),
      }))
      .sort((a, b) => b.techniques.length - a.techniques.length);

    return {
      tacticCounts: counts,
      maxTacticCount: maxC,
      actorTTPs: actors,
      techniqueCoverage: allTechniques.size,
    };
  }, [events]);

  const hasAny = events.some((e) => e.mitreAttackIds.length > 0);

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <p className="text-sm">No events have MITRE ATT&CK techniques mapped.</p>
        <p className="text-xs mt-1">Edit events to add technique IDs and see analytics here.</p>
      </div>
    );
  }

  const coveragePct = ((techniqueCoverage / MITRE_TECHNIQUES.length) * 100).toFixed(1);

  return (
    <div className="space-y-8">
      {/* Section 1: Techniques per Tactic */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Techniques per Tactic</h3>
        <div className="space-y-1.5">
          {tacticCounts.map(({ tactic, count }) => (
            <div key={tactic.id} className="flex items-center gap-2">
              <span className="w-32 text-right text-[11px] text-gray-400 truncate shrink-0" title={tactic.name}>
                {tactic.name}
              </span>
              <div className="flex-1 h-5 bg-gray-800 rounded-sm overflow-hidden">
                {count > 0 && (
                  <div
                    className="h-full bg-teal-500/60 rounded-sm transition-all"
                    style={{ width: `${(count / maxTacticCount) * 100}%` }}
                  />
                )}
              </div>
              <span className="w-6 text-right text-[11px] font-mono text-gray-400 shrink-0">
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Actor TTP Summary */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Actor TTP Summary</h3>
        {actorTTPs.length === 0 ? (
          <p className="text-xs text-gray-500">No actors have techniques mapped.</p>
        ) : (
          <div className="space-y-3">
            {actorTTPs.map((actor) => (
              <div key={actor.name}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-purple-400">{actor.name}</span>
                  <span className="text-[10px] text-gray-500">({actor.techniques.length} technique{actor.techniques.length !== 1 ? 's' : ''})</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {actor.techniques.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-teal-500/15 text-teal-400 border border-teal-500/20"
                      title={`${t.id}: ${t.name}`}
                    >
                      {t.id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3: Coverage */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Technique Coverage</h3>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-bold text-gray-200">{techniqueCoverage}</span>
          <span className="text-sm text-gray-500">/ {MITRE_TECHNIQUES.length}</span>
          <span className="text-sm text-gray-400">({coveragePct}%)</span>
        </div>
        <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500/70 rounded-full transition-all"
            style={{ width: `${(techniqueCoverage / MITRE_TECHNIQUES.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
