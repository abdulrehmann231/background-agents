import React from "react";
import { AbsoluteFill } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { Logo } from "../components/Logo";
import { fontSans, usePalette, useLayout } from "../theme";

export const Brand: React.FC<{ title: string; tagline: string }> = ({
  title,
  tagline,
}) => {
  const palette = usePalette();
  const { s, contentWidth, isPortrait } = useLayout();

  return (
    <AbsoluteFill>
      <Background intensity={1.3} />
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
          <Logo size={isPortrait ? 210 * s : 170 * s} />
          <AnimatedText
            text={title}
            delay={10}
            style={{
              marginTop: 40 * s,
              fontFamily: fontSans,
              fontWeight: 800,
              fontSize: (isPortrait ? 104 : 96) * s,
              letterSpacing: -3 * s,
              color: palette.text,
              lineHeight: 1.05,
            }}
          />
          <AnimatedText
            text={tagline}
            delay={22}
            style={{
              marginTop: 26 * s,
              fontFamily: fontSans,
              fontWeight: 500,
              fontSize: 40 * s,
              lineHeight: 1.35,
              color: palette.muted,
              maxWidth: 900 * s,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
