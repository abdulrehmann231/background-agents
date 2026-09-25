import { z } from "zod";
import { zColor } from "@remotion/zod-types";

/** Everything on screen is editable from the Remotion Studio props panel. */
export const promoSchema = z.object({
  kicker: z.string(),
  hookLine1: z.string(),
  hookLine2: z.string(),
  title: z.string(),
  tagline: z.string(),
  codeHeading: z.string(),
  providersHeading: z.string(),
  providers: z.array(z.string()),
  featuresHeading: z.string(),
  features: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
    }),
  ),
  ctaHeading: z.string(),
  ctaCommand: z.string(),
  ctaUrl: z.string(),
  backgroundColor: zColor(),
  primaryColor: zColor(),
  accentColor: zColor(),
});

export type PromoProps = z.infer<typeof promoSchema>;

export const defaultProps: PromoProps = {
  kicker: "BACKGROUND AGENTS",
  hookLine1: "Your AI agent",
  hookLine2: "shouldn't live on your laptop.",
  title: "Background Agents",
  tagline:
    "Run AI coding agents in isolated Daytona sandboxes — from a single API call.",
  codeHeading: "Five lines. One sandbox.",
  providersHeading: "One interface. Ten agents.",
  providers: [
    "Claude",
    "Codex",
    "Copilot",
    "Droid",
    "Gemini",
    "Goose",
    "Kilo",
    "Kimi",
    "OpenCode",
    "Pi",
  ],
  featuresHeading: "Built for real work.",
  features: [
    {
      title: "Isolated sandboxes",
      detail: "Every agent gets its own secure Daytona environment.",
    },
    {
      title: "Background execution",
      detail: "Start a task, poll for events, survive restarts.",
    },
    {
      title: "Session persistence",
      detail: "Resume conversations across runs and machines.",
    },
    {
      title: "Zero-friction setup",
      detail: "Provider CLIs auto-install inside the sandbox.",
    },
  ],
  ctaHeading: "Ship while you sleep.",
  ctaCommand: "npx background-agents",
  ctaUrl: "backgrounder.dev · open source on GitHub",
  backgroundColor: "#08080b",
  primaryColor: "#4aa651",
  accentColor: "#6ee07a",
};
