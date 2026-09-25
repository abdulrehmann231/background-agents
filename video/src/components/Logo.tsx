import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { usePalette } from "../theme";

/**
 * Wordless mark: a sandbox (rounded square) holding a terminal prompt,
 * with a satellite dot orbiting it — the agent working in the background.
 */
export const Logo: React.FC<{ size: number; delay?: number }> = ({
  size,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = usePalette();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, mass: 0.8 },
  });
  const angle = interpolate(frame - delay, [0, 120], [0, Math.PI * 2]);
  const orbitR = size * 0.44;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        transform: `scale(${enter})`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          <linearGradient id="sandbox" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={palette.primaryBright} />
            <stop offset="100%" stopColor={palette.primary} />
          </linearGradient>
        </defs>
        <rect
          x="14"
          y="14"
          width="72"
          height="72"
          rx="20"
          fill="none"
          stroke="url(#sandbox)"
          strokeWidth="6"
        />
        <path
          d="M36 40 L48 50 L36 60"
          fill="none"
          stroke={palette.primaryBright}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M55 62 L66 62"
          stroke={palette.text}
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: size / 2 + Math.cos(angle) * orbitR - size * 0.045,
          top: size / 2 + Math.sin(angle) * orbitR - size * 0.045,
          width: size * 0.09,
          height: size * 0.09,
          borderRadius: "50%",
          backgroundColor: palette.primaryBright,
          boxShadow: `0 0 ${size * 0.16}px ${palette.primaryBright}`,
          opacity: enter,
        }}
      />
    </div>
  );
};
