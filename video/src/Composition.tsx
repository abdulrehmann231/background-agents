import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { PaletteContext, defaultPalette } from "./theme";
import { Hook } from "./scenes/Hook";
import { Brand } from "./scenes/Brand";
import { Code } from "./scenes/Code";
import { Providers } from "./scenes/Providers";
import { Features } from "./scenes/Features";
import { CTA } from "./scenes/CTA";
import type { PromoProps } from "./schema";

/** Scene lengths in frames @30fps; 5 transitions of 15 frames overlap them. */
export const sceneDurations = {
  hook: 90,
  brand: 105,
  code: 150,
  providers: 120,
  features: 135,
  cta: 120,
};
const TRANSITION = 15;

export const TOTAL_DURATION =
  Object.values(sceneDurations).reduce((a, b) => a + b, 0) - TRANSITION * 5;

const timing = linearTiming({ durationInFrames: TRANSITION });

export const Promo: React.FC<PromoProps> = (props) => {
  const palette = {
    ...defaultPalette,
    background: props.backgroundColor,
    primary: props.primaryColor,
    primaryBright: props.accentColor,
  };

  return (
    <PaletteContext.Provider value={palette}>
      <AbsoluteFill style={{ backgroundColor: palette.background }}>
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={sceneDurations.hook}>
            <Hook
              kicker={props.kicker}
              line1={props.hookLine1}
              line2={props.hookLine2}
            />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={fade()} timing={timing} />

          <TransitionSeries.Sequence durationInFrames={sceneDurations.brand}>
            <Brand title={props.title} tagline={props.tagline} />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition
            presentation={slide({ direction: "from-bottom" })}
            timing={timing}
          />

          <TransitionSeries.Sequence durationInFrames={sceneDurations.code}>
            <Code heading={props.codeHeading} />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={fade()} timing={timing} />

          <TransitionSeries.Sequence durationInFrames={sceneDurations.providers}>
            <Providers
              heading={props.providersHeading}
              providers={props.providers}
            />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={fade()} timing={timing} />

          <TransitionSeries.Sequence durationInFrames={sceneDurations.features}>
            <Features
              heading={props.featuresHeading}
              features={props.features}
            />
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition
            presentation={slide({ direction: "from-right" })}
            timing={timing}
          />

          <TransitionSeries.Sequence durationInFrames={sceneDurations.cta}>
            <CTA
              heading={props.ctaHeading}
              command={props.ctaCommand}
              url={props.ctaUrl}
            />
          </TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    </PaletteContext.Provider>
  );
};
