import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { fontSans, usePalette, useLayout } from "../theme";

export type Feature = { title: string; detail: string };

export const Features: React.FC<{ heading: string; features: Feature[] }> = ({
  heading,
  features,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = usePalette();
  const { s, contentWidth, isPortrait } = useLayout();

  return (
    <AbsoluteFill>
      <Background intensity={0.8} />
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
              marginBottom: 40 * s,
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPortrait ? "1fr" : "1fr 1fr",
              gap: 20 * s,
            }}
          >
            {features.map((feature, i) => {
              const enter = spring({
                frame: frame - 14 - i * 7,
                fps,
                config: { damping: 200, mass: 0.6 },
              });
              return (
                <div
                  key={feature.title}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 22 * s,
                    padding: `${26 * s}px ${30 * s}px`,
                    borderRadius: 22 * s,
                    backgroundColor: palette.surface,
                    border: `${Math.max(1, s)}px solid ${palette.text}12`,
                    opacity: enter,
                    transform: `translateX(${(1 - enter) * -40 * s}px)`,
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 54 * s,
                      height: 54 * s,
                      borderRadius: "50%",
                      backgroundColor: `${palette.primary}26`,
                      border: `${Math.max(1, 2 * s)}px solid ${palette.primary}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width={28 * s} height={28 * s} viewBox="0 0 24 24">
                      <path
                        d="M4 12.5 L9.5 18 L20 6.5"
                        fill="none"
                        stroke={palette.primaryBright}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={26}
                        strokeDashoffset={26 * (1 - enter)}
                      />
                    </svg>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: fontSans,
                        fontWeight: 700,
                        fontSize: 40 * s,
                        color: palette.text,
                        lineHeight: 1.2,
                      }}
                    >
                      {feature.title}
                    </div>
                    <div
                      style={{
                        fontFamily: fontSans,
                        fontWeight: 400,
                        fontSize: 28 * s,
                        color: palette.muted,
                        marginTop: 6 * s,
                        lineHeight: 1.3,
                      }}
                    >
                      {feature.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
