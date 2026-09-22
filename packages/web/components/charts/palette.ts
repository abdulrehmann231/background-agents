import { ALL_AGENTS, providerToAgent, providerLabel, type Agent, type ProviderName } from "@background-agents/common"

/**
 * Categorical series colours, in fixed slot order.
 *
 * Concrete values rather than `var(--series-n)` on purpose: CSS custom
 * properties don't resolve inside SVG *presentation attributes*, only in inline
 * styles, and Recharts sets `fill` as an attribute — a `var()` there silently
 * paints every bar black.
 *
 * The two sets were validated independently against their own surface, so dark
 * is a chosen set of steps rather than a lightened copy of light. Both pass the
 * lightness band, chroma floor and adjacent-pair CVD separation checks. On the
 * light surface three steps fall under 3:1 contrast, which is why every chart
 * drawing this palette also carries a legend naming each series: identity is
 * never left to colour alone. Re-validate rather than eyeball if you edit one.
 */
const SERIES_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const

const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const

/** Anything folded into the tail — deliberately neutral, not a ninth hue. */
const OTHER_COLOR = "#898781"

/** The key a folded tail is grouped under. */
export const OTHER_KEY = "__other__"

/**
 * How many distinct series a chart may draw before the tail must be folded.
 * Eight is the ceiling the palette was validated at; a ninth colour would be
 * indistinguishable from an existing one under colour-vision deficiency.
 * "Other" is not one of the eight, since it is drawn in grey.
 */
export const MAX_SERIES = SERIES_LIGHT.length

/**
 * Agent → colour slot, fixed for the life of the product.
 *
 * Assigned by position in ALL_AGENTS rather than by rank in whatever the user
 * is currently looking at: filtering to one repo must not repaint the agents
 * that survive the filter. There are more agents (11) than slots (8), so the
 * map wraps — but any chart drawing more than MAX_SERIES at once folds its tail
 * into "Other" first, so two agents sharing a slot can never appear together.
 */
const AGENT_SLOT: Record<Agent, number> = Object.fromEntries(
  ALL_AGENTS.map((agent, i) => [agent, i % MAX_SERIES])
) as Record<Agent, number>

/**
 * Colour for a series keyed by SDK provider name (what TokenUsage stores).
 *
 * `isDark` is passed in rather than read from the document so the caller — which
 * already knows the resolved theme — stays the single place that decides.
 */
export function seriesColor(provider: string, isDark: boolean): string {
  if (provider === OTHER_KEY) return OTHER_COLOR
  const agent = providerToAgent[provider as ProviderName]
  if (!agent) return OTHER_COLOR
  return (isDark ? SERIES_DARK : SERIES_LIGHT)[AGENT_SLOT[agent]]
}

/** Display label for a series keyed by provider name. */
export function providerSeriesLabel(provider: string): string {
  return provider === OTHER_KEY ? "Other" : providerLabel(provider as ProviderName)
}

/**
 * Rank `providers` by `weight` and fold everything past MAX_SERIES into a
 * single "Other" key, so a chart never needs a ninth colour.
 *
 * Returns the keys to draw, in descending weight order. "Other" always sorts
 * last regardless of its size — it is a remainder, not a competitor.
 */
export function foldSeries(
  providers: string[],
  weight: (provider: string) => number
): string[] {
  const ranked = [...providers]
    .filter((p) => weight(p) > 0)
    .sort((a, b) => weight(b) - weight(a))
  if (ranked.length <= MAX_SERIES) return ranked
  return [...ranked.slice(0, MAX_SERIES), OTHER_KEY]
}
