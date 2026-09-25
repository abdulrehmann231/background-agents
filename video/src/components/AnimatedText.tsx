import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = {
  text: string;
  delay?: number;
  style?: React.CSSProperties;
  /** Stagger each word instead of animating the whole line. */
  perWord?: boolean;
};

/** Spring-based reveal: rises into place with a short blur-free fade. */
export const AnimatedText: React.FC<Props> = ({
  text,
  delay = 0,
  style,
  perWord = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const reveal = (index: number) => {
    const progress = spring({
      frame: frame - delay - index * 3,
      fps,
      config: { damping: 200, mass: 0.6 },
    });
    return {
      opacity: progress,
      transform: `translateY(${(1 - progress) * 28}px)`,
    };
  };

  if (!perWord) {
    return <div style={{ ...style, ...reveal(0) }}>{text}</div>;
  }

  return (
    <div style={{ ...style, display: "flex", flexWrap: "wrap", gap: "0.28em" }}>
      {text.split(" ").map((word, i) => (
        <span key={`${word}-${i}`} style={{ display: "inline-block", ...reveal(i) }}>
          {word}
        </span>
      ))}
    </div>
  );
};
