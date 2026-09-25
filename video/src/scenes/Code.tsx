import React from "react";
import { AbsoluteFill } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { Background } from "../components/Background";
import { CodeWindow, syntax } from "../components/CodeWindow";
import { fontSans, usePalette, useLayout } from "../theme";

const lines = [
  [
    { text: "import ", color: syntax.keyword },
    { text: "{ createSession } ", color: syntax.plain },
    { text: "from ", color: syntax.keyword },
    { text: '"@background-agents/sdk"', color: syntax.string },
  ],
  [],
  [
    { text: "const ", color: syntax.keyword },
    { text: "session = ", color: syntax.plain },
    { text: "await ", color: syntax.keyword },
    { text: "createSession", color: syntax.klass },
    { text: "(", color: syntax.plain },
    { text: '"claude"', color: syntax.string },
    { text: ", { sandbox })", color: syntax.plain },
  ],
  [],
  [
    { text: "await ", color: syntax.keyword },
    { text: "session.", color: syntax.plain },
    { text: "start", color: syntax.klass },
    { text: "(", color: syntax.plain },
    { text: '"Refactor the auth module"', color: syntax.string },
    { text: ")", color: syntax.plain },
  ],
  [],
  [{ text: "// agent runs on, even if you close the tab", color: syntax.comment }],
];

export const Code: React.FC<{ heading: string }> = ({ heading }) => {
  const palette = usePalette();
  const { s, contentWidth } = useLayout();

  return (
    <AbsoluteFill>
      <Background intensity={0.7} />
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
              fontSize: 62 * s,
              letterSpacing: -1.5 * s,
              color: palette.text,
              marginBottom: 34 * s,
            }}
          />
          <CodeWindow
            title="agent.ts"
            lines={lines}
            delay={10}
            width={contentWidth}
            scale={s}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
