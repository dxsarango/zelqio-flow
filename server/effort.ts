import type { ZelqioSettings } from "../shared/settings";

export type Complexity = "low" | "medium" | "high";

interface ThinkingOption {
  id: string;
  label: string;
  isDefault: boolean;
}

// Providers name their reasoning levels differently, so the level is read from the id or label.
// An option that matches none of these is left alone: the provider's own default applies.
const LEVELS: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 3, pattern: /\b(xhigh|x-high|max|maximum|ultra)\b/i },
  { rank: 2, pattern: /\b(high|extended|deep)\b/i },
  { rank: 1, pattern: /\b(medium|med|normal|standard|balanced)\b/i },
  { rank: 0, pattern: /\b(none|off|minimal|min|low|fast|quick)\b/i },
];

function rankOf(option: ThinkingOption): number | null {
  const text = `${option.id} ${option.label}`;
  for (const { rank, pattern } of LEVELS) if (pattern.test(text)) return rank;
  return null;
}

const BASE: Record<Complexity, number> = { low: 0, medium: 1, high: 2 };

/** A longer, multi-part request tends to need more reasoning than a one-line one. */
export function estimateComplexity(prompt: string): Complexity {
  const text = prompt.trim();
  if (text.length > 2500 || (text.match(/\n/g)?.length ?? 0) > 25) return "high";
  if (text.length < 160 && !text.includes("\n")) return "low";
  return "medium";
}

/**
 * Picks the reasoning level for a model: the complexity sets the target, a tight quota or an economical strategy lowers
 * it one step and a quality-first strategy raises it. Returns undefined when the model has no recognizable levels, so
 * the provider default is used.
 */
export function chooseEffort(
  options: readonly ThinkingOption[],
  input: { complexity: Complexity; strategy: ZelqioSettings["strategy"]; quotaLow?: boolean },
): string | undefined {
  const ranked = options.map(option => ({ option, rank: rankOf(option) })).filter((entry): entry is { option: ThinkingOption; rank: number } => entry.rank !== null);
  if (ranked.length === 0) return undefined;
  let target = BASE[input.complexity];
  if (input.strategy === "economy" || input.quotaLow) target -= 1;
  else if (input.strategy === "quality_first") target += 1;
  target = Math.max(0, Math.min(3, target));
  const best = [...ranked].sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target) || a.rank - b.rank)[0];
  return best.option.id;
}
