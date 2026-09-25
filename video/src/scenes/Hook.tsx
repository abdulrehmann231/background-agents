import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { fontSans, fontMono, usePalette, useLayout } from "../theme";

export const Hook: React.FC<{ kicker: string; line1: string; line2: string }> = ({
  kicker,
  line1,
  line2,
}) => {
  const frame = useCurrentFrame();
  const palette = usePalette();
  const { s, contentWidth } = useLayout();

  const underline = interpolate(frame, [34, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 60 * s,
        }}
      >
        <div style={{ width: contentWidth }}>
          <div
            style={{
              display: "inline-flex",
              width: "fit-content",
              alignItems: "center",
              gap: 12 * s,
              padding: `${10 * s}px ${22 * s}px`,
              borderRadius: 999,
              border: `${Math.max(1, s)}px solid ${palette.primary}66`,
              backgroundColor: `${palette.primary}1f`,
              fontFamily: fontMono,
              fontSize: 24 * s,
              color: palette.primaryBright,
              letterSpacing: 1.5 * s,
              opacity: interpolate(frame, [0, 12], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span
              style={{
                width: 12 * s,
                height: 12 * s,
                borderRadius: "50%",
                backgroundColor: palette.primaryBright,
                boxShadow: `0 0 ${14 * s}px ${palette.primaryBright}`,
              }}
            />
            {kicker}
          </div>

          <AnimatedText
            text={line1}
            delay={8}
            perWord
            style={{
              marginTop: 36 * s,
              fontFamily: fontSans,
              fontWeight: 800,
              fontSize: 96 * s,
              lineHeight: 1.05,
              color: palette.text,
              letterSpacing: -2 * s,
            }}
          />

          <div style={{ position: "relative", width: "fit-content" }}>
            <AnimatedText
              text={line2}
              delay={22}
              perWord
              style={{
                fontFamily: fontSans,
                fontWeight: 800,
                fontSize: 96 * s,
                lineHeight: 1.05,
                color: palette.primaryBright,
                letterSpacing: -2 * s,
              }}
            />
            <div
              style={{
                height: 8 * s,
                borderRadius: 999,
                marginTop: 22 * s,
                width: `${underline * 100}%`,
                background: `linear-gradient(90deg, ${palette.primary}, ${palette.primaryBright})`,
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
