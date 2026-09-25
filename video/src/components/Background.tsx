import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { usePalette, useLayout } from "../theme";

/** Dark canvas with a slow-drifting brand glow and a faint terminal grid. */
export const Background: React.FC<{ intensity?: number }> = ({
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const palette = usePalette();
  const { s, width, height } = useLayout();

  const drift = Math.sin(frame / 90) * 60 * s;
  const pulse = interpolate(Math.sin(frame / 45), [-1, 1], [0.45, 0.85]);
  const cell = 64 * s;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.background }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${palette.text}0d 1px, transparent 1px), linear-gradient(90deg, ${palette.text}0d 1px, transparent 1px)`,
          backgroundSize: `${cell}px ${cell}px`,
          opacity: 0.5,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(${width * 0.55}px ${
            height * 0.35
          }px at ${width / 2 + drift}px ${
            height * 0.38
          }px, ${palette.primary}44, transparent 70%)`,
          opacity: pulse * intensity,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 50%, transparent 40%, ${palette.background} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
