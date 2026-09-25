import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { Logo } from "../components/Logo";
import { fontSans, fontMono, usePalette, useLayout } from "../theme";

export const CTA: React.FC<{
  heading: string;
  command: string;
  url: string;
}> = ({ heading, command, url }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = usePalette();
  const { s, contentWidth, isPortrait } = useLayout();

  const boxEnter = spring({
    frame: frame - 18,
    fps,
    config: { damping: 200, mass: 0.7 },
  });
  const typed = Math.max(0, Math.floor((frame - 26) * 1.6));
  const glow = interpolate(Math.sin(frame / 12), [-1, 1], [0.35, 0.9]);

  return (
    <AbsoluteFill>
      <Background intensity={1.4} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 60 * s,
        }}
      >
        <div
          style={{
            width: contentWidth,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <Logo size={isPortrait ? 150 * s : 130 * s} />
          <AnimatedText
            text={heading}
            delay={8}
            style={{
              marginTop: 32 * s,
              fontFamily: fontSans,
              fontWeight: 800,
              fontSize: 78 * s,
              letterSpacing: -2 * s,
              color: palette.text,
              lineHeight: 1.1,
            }}
          />
          <div
            style={{
              marginTop: 40 * s,
              padding: `${24 * s}px ${40 * s}px`,
              borderRadius: 18 * s,
              backgroundColor: palette.surface,
              border: `${Math.max(1, 2 * s)}px solid ${palette.primary}`,
              boxShadow: `0 0 ${40 * s}px ${palette.primary}${glow > 0.6 ? "66" : "33"}`,
              fontFamily: fontMono,
              fontSize: 44 * s,
              color: palette.primaryBright,
              opacity: boxEnter,
              transform: `scale(${0.92 + boxEnter * 0.08})`,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: palette.muted }}>$ </span>
            {command.slice(0, typed)}
            {Math.floor(frame / 8) % 2 === 0 ? "▍" : " "}
          </div>
          <div
            style={{
              marginTop: 34 * s,
              fontFamily: fontSans,
              fontWeight: 600,
              fontSize: 34 * s,
              color: palette.muted,
              opacity: interpolate(frame, [40, 58], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {url}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
