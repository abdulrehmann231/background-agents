import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { usePalette, fontMono, fontSans } from "../theme";

export type Token = { text: string; color?: string };
export type CodeLine = Token[];

/** Token colors mirror the app's dark syntax theme in globals.css. */
export const syntax = {
  keyword: "#ff79c6",
  string: "#c3e88d",
  entity: "#c792ea",
  property: "#82aaff",
  klass: "#89ddff",
  plain: "#d4d4d4",
  comment: "#676e95",
};

type Props = {
  title: string;
  lines: CodeLine[];
  delay?: number;
  charsPerFrame?: number;
  width: number;
  scale: number;
};

/** macOS-style window that types its contents out character by character. */
export const CodeWindow: React.FC<Props> = ({
  title,
  lines,
  delay = 0,
  charsPerFrame = 3.2,
  width,
  scale,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = usePalette();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 0.7 },
  });
  const typed = Math.max(0, (frame - delay - 8) * charsPerFrame);
  const fontSize = 24 * scale;

  let consumed = 0;
  const cursorLine = (() => {
    let remaining = typed;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].reduce((n, t) => n + t.text.length, 0);
      if (remaining <= len) return i;
      remaining -= len;
    }
    return lines.length - 1;
  })();
  const blink = Math.floor(frame / 8) % 2 === 0;

  return (
    <div
      style={{
        width,
        borderRadius: 20 * scale,
        overflow: "hidden",
        backgroundColor: palette.surface,
        border: `${Math.max(1, scale)}px solid ${palette.text}1a`,
        boxShadow: `0 ${30 * scale}px ${70 * scale}px #00000099`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40 * scale}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10 * scale,
          padding: `${14 * scale}px ${20 * scale}px`,
          borderBottom: `${Math.max(1, scale)}px solid ${palette.text}12`,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div
            key={c}
            style={{
              width: 13 * scale,
              height: 13 * scale,
              borderRadius: "50%",
              backgroundColor: c,
            }}
          />
        ))}
        <div
          style={{
            marginLeft: 12 * scale,
            fontFamily: fontSans,
            fontSize: 20 * scale,
            color: palette.muted,
          }}
        >
          {title}
        </div>
      </div>

      <div
        style={{
          padding: `${26 * scale}px ${28 * scale}px ${32 * scale}px`,
          fontFamily: fontMono,
          fontSize,
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
        }}
      >
        {lines.map((line, li) => {
          const rendered: React.ReactNode[] = [];
          line.forEach((token, ti) => {
            const start = consumed;
            consumed += token.text.length;
            const visible = Math.max(
              0,
              Math.min(token.text.length, Math.floor(typed - start)),
            );
            rendered.push(
              <span key={ti} style={{ color: token.color ?? syntax.plain }}>
                {token.text.slice(0, visible)}
              </span>,
            );
          });
          return (
            <div key={li} style={{ minHeight: fontSize * 1.65 }}>
              {rendered}
              {li === cursorLine && blink ? (
                <span style={{ color: palette.primaryBright }}>▍</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
