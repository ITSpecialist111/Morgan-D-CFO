/**
 * ArtifactJudge — configurable scoring rubric for agent-produced outputs.
 *
 * Scores reports, plans, briefings, and documents on completeness, evidence,
 * actionability, and governance before they are delivered to humans or
 * published externally.
 *
 * Generalised from Morgan's evaluateMissionArtifact in missionControl.ts.
 */

import type { ArtifactCheck, ArtifactEvaluation, ArtifactVerdict } from '../types';

export interface JudgeRubricItem {
  id: string;
  label: string;
  /** Weight 0-1. Weights for all rubric items are normalised internally. */
  weight: number;
  /** Return a score 0-10 and a rationale string. */
  evaluate: (artifact: JudgeArtifact) => { score: number; rationale: string };
}

export interface JudgeArtifact {
  /** Logical type name (e.g. "cfo-report", "board-briefing", "plan"). */
  type: string;
  title: string;
  /** The content to evaluate (text, JSON string, or summary). */
  content: string;
  /** Observable evidence items linked to this artifact. */
  evidence: string[];
  /** Any additional metadata the rubric items may use. */
  meta?: Record<string, unknown>;
}

/** Scores below this threshold get verdict 'blocked'. */
const BLOCKED_THRESHOLD = 40;
/** Scores below this threshold get verdict 'needs-review'. */
const REVIEW_THRESHOLD = 70;

function verdict(score: number): ArtifactVerdict {
  if (score < BLOCKED_THRESHOLD) return 'blocked';
  if (score < REVIEW_THRESHOLD) return 'needs-review';
  return 'ready';
}

/** Default rubric — sensible for most digital-worker artifacts. */
const DEFAULT_RUBRIC: JudgeRubricItem[] = [
  {
    id: 'completeness',
    label: 'Completeness',
    weight: 0.3,
    evaluate: ({ content }) => {
      const words = content.trim().split(/\s+/).length;
      if (words < 20) return { score: 2, rationale: 'Content is too short to be actionable.' };
      if (words < 80) return { score: 5, rationale: 'Content present but brief.' };
      return { score: 9, rationale: 'Content has sufficient depth.' };
    },
  },
  {
    id: 'evidence',
    label: 'Evidence',
    weight: 0.25,
    evaluate: ({ evidence }) => {
      if (!evidence.length) return { score: 1, rationale: 'No evidence items attached.' };
      if (evidence.length < 2) return { score: 5, rationale: 'Minimal evidence attached.' };
      return { score: 9, rationale: `${evidence.length} evidence items attached.` };
    },
  },
  {
    id: 'actionability',
    label: 'Actionability',
    weight: 0.25,
    evaluate: ({ content }) => {
      const actionWords = /\b(should|must|recommend|action|next step|follow up|escalate|approve|review|decision)\b/i;
      return actionWords.test(content)
        ? { score: 9, rationale: 'Contains actionable language.' }
        : { score: 4, rationale: 'No clear next actions detected.' };
    },
  },
  {
    id: 'governance',
    label: 'Governance',
    weight: 0.2,
    evaluate: ({ meta }) => {
      const hasApproval = meta?.['approvalRequired'] === false || meta?.['approvalGranted'] === true;
      return hasApproval
        ? { score: 10, rationale: 'Governance check passed.' }
        : { score: 6, rationale: 'Governance status not explicitly confirmed.' };
    },
  },
];

export class ArtifactJudge {
  private readonly rubric: JudgeRubricItem[];

  constructor(rubric: JudgeRubricItem[] = DEFAULT_RUBRIC) {
    // NB2 fix: reject empty rubrics and zero/negative weights to prevent NaN scores.
    if (!rubric.length) throw new Error('ArtifactJudge rubric must contain at least one item.');
    for (const item of rubric) {
      if (!Number.isFinite(item.weight) || item.weight <= 0) {
        throw new Error(`ArtifactJudge rubric item "${item.id}" has an invalid weight: ${item.weight}. Weight must be a positive finite number.`);
      }
    }
    this.rubric = rubric;
  }

  evaluate(artifact: JudgeArtifact): ArtifactEvaluation {
    const totalWeight = this.rubric.reduce((sum, item) => sum + item.weight, 0);
    const checks: ArtifactCheck[] = [];
    let weightedScore = 0;

    for (const rubricItem of this.rubric) {
      const { score, rationale } = rubricItem.evaluate(artifact);
      const clampedScore = Math.max(0, Math.min(10, score));
      const normWeight = rubricItem.weight / totalWeight;
      weightedScore += clampedScore * normWeight * 10;
      checks.push({
        id: rubricItem.id,
        label: rubricItem.label,
        score: clampedScore,
        pass: clampedScore >= 5,
        rationale,
      });
    }

    const finalScore = Math.round(weightedScore);
    const finalVerdict = verdict(finalScore);

    return {
      id: `eval-${Date.now().toString(36)}`,
      evaluatedAt: new Date().toISOString(),
      artifactType: artifact.type,
      title: artifact.title,
      score: finalScore,
      verdict: finalVerdict,
      rationale: `Score ${finalScore}/100. Verdict: ${finalVerdict}.`,
      checks,
    };
  }
}
