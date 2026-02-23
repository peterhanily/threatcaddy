import { useMemo } from 'react';
import { MITRE_TACTICS, MITRE_TECHNIQUES, getParentTechniqueId, confidenceToRank } from '../../lib/mitre-attack';
import type { TimelineEvent } from '../../types';

export type HeatmapColorMode = 'count' | 'confidence' | 'actors';

interface MitreHeatmapProps {
  events: TimelineEvent[];
  colorMode: HeatmapColorMode;
  onTechniqueClick: (techniqueId: string) => void;
}

/** 5-step warm gradient: gray → amber → orange → red-orange → red */
function heatColor(count: number, max: number): { bg: string; text: string } {
  if (count === 0 || max === 0) return { bg: 'rgba(31,41,55,0.5)', text: '#4b5563' };
  const ratio = count / max;
  if (ratio <= 0.25) return { bg: 'rgba(245,158,11,0.2)', text: '#f59e0b' };   // amber
  if (ratio <= 0.5)  return { bg: 'rgba(249,115,22,0.3)', text: '#f97316' };   // orange
  if (ratio <= 0.75) return { bg: 'rgba(239,68,68,0.3)', text: '#ef4444' };    // red-orange
  return { bg: 'rgba(239,68,68,0.5)', text: '#fca5a5' };                       // red
}

/** 5-step confidence gradient: gray → gray → yellow → orange → red */
function confidenceColor(rank: number): { bg: string; text: string } {
  switch (rank) {
    case 0: return { bg: 'rgba(31,41,55,0.5)', text: '#4b5563' };
    case 1: return { bg: 'rgba(107,114,128,0.3)', text: '#9ca3af' };   // low - gray
    case 2: return { bg: 'rgba(234,179,8,0.3)', text: '#eab308' };     // medium - yellow
    case 3: return { bg: 'rgba(249,115,22,0.4)', text: '#f97316' };    // high - orange
    case 4: return { bg: 'rgba(239,68,68,0.5)', text: '#fca5a5' };     // confirmed - red
    default: return { bg: 'rgba(31,41,55,0.5)', text: '#4b5563' };
  }
}

interface TechData {
  id: string;
  name: string;
  count: number;
  maxConfidence: number;
  actorCount: number;
}

function getCellColor(tech: TechData, mode: HeatmapColorMode, maxCount: number, maxActorCount: number): { bg: string; text: string } {
  switch (mode) {
    case 'count': return heatColor(tech.count, maxCount);
    case 'confidence': return confidenceColor(tech.maxConfidence);
    case 'actors': return heatColor(tech.actorCount, maxActorCount);
  }
}

export function MitreHeatmap({ events, colorMode, onTechniqueClick }: MitreHeatmapProps) {
  const { columns, maxCount, maxActorCount, stats } = useMemo(() => {
    // Build maps: parentTechniqueId → aggregated data
    const countMap = new Map<string, Set<string>>();
    const confMap = new Map<string, number>();
    const actorMap = new Map<string, Set<string>>();
    const tacticsHit = new Set<string>();

    for (const ev of events) {
      for (const id of ev.mitreAttackIds) {
        const parent = getParentTechniqueId(id);

        // Count map
        let countSet = countMap.get(parent);
        if (!countSet) { countSet = new Set(); countMap.set(parent, countSet); }
        countSet.add(ev.id);

        // Confidence map (keep max)
        const rank = confidenceToRank(ev.confidence);
        const prev = confMap.get(parent) || 0;
        if (rank > prev) confMap.set(parent, rank);

        // Actor map
        if (ev.actor) {
          let actSet = actorMap.get(parent);
          if (!actSet) { actSet = new Set(); actorMap.set(parent, actSet); }
          actSet.add(ev.actor);
        }
      }
    }

    let maxC = 0;
    countMap.forEach((s) => { if (s.size > maxC) maxC = s.size; });

    let maxA = 0;
    actorMap.forEach((s) => { if (s.size > maxA) maxA = s.size; });

    // Group techniques by tactic
    const cols = MITRE_TACTICS.map((tactic) => {
      const techs: TechData[] = MITRE_TECHNIQUES
        .filter((t) => t.tactics.includes(tactic.shortName))
        .map((t) => {
          const count = countMap.get(t.id)?.size || 0;
          if (count > 0) tacticsHit.add(tactic.shortName);
          return {
            id: t.id,
            name: t.name,
            count,
            maxConfidence: confMap.get(t.id) || 0,
            actorCount: actorMap.get(t.id)?.size || 0,
          };
        });
      return { tactic, techniques: techs };
    });

    const totalEventsWithMitre = events.filter((e) => e.mitreAttackIds.length > 0).length;

    return {
      columns: cols,
      maxCount: maxC,
      maxActorCount: maxA,
      stats: {
        totalTechniquesMapped: countMap.size,
        totalEventsWithMitre,
        tacticsWithCoverage: tacticsHit.size,
      },
    };
  }, [events]);

  const hasAny = events.some((e) => e.mitreAttackIds.length > 0);

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <p className="text-sm">No events have MITRE ATT&CK techniques mapped.</p>
        <p className="text-xs mt-1">Edit events to add technique IDs and see coverage here.</p>
      </div>
    );
  }

  // Legend configuration per mode
  const legendLabel = colorMode === 'count' ? 'Events' : colorMode === 'confidence' ? 'Confidence' : 'Actors';
  const legendSteps = colorMode === 'confidence'
    ? [
        { label: 'None', ...confidenceColor(0) },
        { label: 'Low', ...confidenceColor(1) },
        { label: 'Med', ...confidenceColor(2) },
        { label: 'High', ...confidenceColor(3) },
        { label: 'Conf', ...confidenceColor(4) },
      ]
    : [
        { label: '0', ...heatColor(0, 1) },
        { label: 'Low', ...heatColor(1, 4) },
        { label: '', ...heatColor(2, 4) },
        { label: '', ...heatColor(3, 4) },
        { label: 'High', ...heatColor(4, 4) },
      ];

  const maxLabel = colorMode === 'count'
    ? `${maxCount} max event${maxCount !== 1 ? 's' : ''} per technique`
    : colorMode === 'actors'
      ? `${maxActorCount} max actor${maxActorCount !== 1 ? 's' : ''} per technique`
      : '';

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-gray-400 px-1">
        <span>Techniques: <span className="text-gray-200 font-medium">{stats.totalTechniquesMapped}</span>/{MITRE_TECHNIQUES.length}</span>
        <span>Events w/ MITRE: <span className="text-gray-200 font-medium">{stats.totalEventsWithMitre}</span></span>
        <span>Tactics hit: <span className="text-gray-200 font-medium">{stats.tacticsWithCoverage}</span>/{MITRE_TACTICS.length}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-gray-400 px-1">
        <span>{legendLabel}:</span>
        <div className="flex items-center gap-1">
          {legendSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className="w-5 h-3 rounded-sm border border-gray-700/50"
                style={{ backgroundColor: step.bg }}
              />
              {step.label && <span className="text-[10px]">{step.label}</span>}
            </div>
          ))}
        </div>
        {maxLabel && (
          <span className="ml-auto text-[10px] text-gray-600">{maxLabel}</span>
        )}
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-px" style={{ minWidth: `${columns.length * 140}px` }}>
          {columns.map(({ tactic, techniques }) => (
            <div key={tactic.id} className="flex-1 min-w-[140px] flex flex-col">
              {/* Tactic header */}
              <div className="sticky top-0 z-10 px-1.5 py-2 bg-gray-900 border-b border-gray-700">
                <div className="text-[10px] font-semibold text-gray-300 truncate" title={tactic.name}>
                  {tactic.name}
                </div>
                <div className="text-[9px] text-gray-600 font-mono">{tactic.id}</div>
              </div>

              {/* Technique cells */}
              <div className="flex flex-col gap-px p-0.5">
                {techniques.map((tech) => {
                  const color = getCellColor(tech, colorMode, maxCount, maxActorCount);
                  const clickable = tech.count > 0;
                  const confLabels = ['—', 'Low', 'Medium', 'High', 'Confirmed'];
                  const tooltip = `${tech.id}: ${tech.name}\n${tech.count} event${tech.count !== 1 ? 's' : ''} · Confidence: ${confLabels[tech.maxConfidence]} · ${tech.actorCount} actor${tech.actorCount !== 1 ? 's' : ''}`;
                  return (
                    <button
                      key={tech.id}
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && onTechniqueClick(tech.id)}
                      className={`text-left px-1.5 py-1 rounded-sm transition-colors ${
                        clickable ? 'cursor-pointer hover:ring-1 hover:ring-gray-500' : 'cursor-default'
                      }`}
                      style={{ backgroundColor: color.bg }}
                      title={tooltip}
                    >
                      <div className="font-mono text-[9px] leading-tight" style={{ color: color.text }}>
                        {tech.id}
                      </div>
                      <div className="text-[9px] leading-tight truncate text-gray-500">
                        {tech.name}
                      </div>
                      {tech.count > 0 && (
                        <div className="text-[9px] font-medium mt-0.5" style={{ color: color.text }}>
                          {tech.count}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
