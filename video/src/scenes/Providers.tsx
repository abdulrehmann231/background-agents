import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { fontSans, fontMono, usePalette, useLayout } from "../theme";

export const Providers: React.FC<{ heading: string; providers: string[] }> = ({
  heading,
  providers,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = usePalette();
  const { s, contentWidth, isPortrait } = useLayout();

  return (
    <AbsoluteFill>
      <Background intensity={0.9} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: 60 * s,
        }}
      >
        <div style={{ width: contentWidth }}>
          <AnimatedText
            text={heading}
            perWord
            style={{
              fontFamily: fontSans,
              fontWeight: 800,
              fontSize: 72 * s,
              letterSpacing: -2 * s,
              color: palette.text,
              marginBottom: 44 * s,
            }}
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 18 * s,
              justifyContent: isPortrait ? "flex-start" : "center",
            }}
          >
            {providers.map((name, i) => {
              const enter = spring({
                frame: frame - 12 - i * 4,
                fps,
                config: { damping: 13, mass: 0.5 },
              });
              return (
                <div
                  key={name}
                  style={{
                    display: "inline-flex",
                    width: "fit-content",
                    alignItems: "center",
                    gap: 12 * s,
                    padding: `${16 * s}px ${28 * s}px`,
                    borderRadius: 999,
                    backgroundColor: palette.surface,
                    border: `${Math.max(1, s)}px solid ${palette.primary}40`,
                    fontFamily: fontMono,
                    fontSize: 34 * s,
                    color: palette.text,
                    opacity: Math.min(1, enter),
                    transform: `scale(${0.8 + enter * 0.2})`,
                  }}
                >
                  <span
                    style={{
                      width: 12 * s,
                      height: 12 * s,
                      borderRadius: "50%",
                      backgroundColor: palette.primaryBright,
                      boxShadow: `0 0 ${12 * s}px ${palette.primaryBright}`,
                    }}
                  />
                  {name}
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
