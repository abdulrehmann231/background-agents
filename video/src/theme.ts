import { createContext, useContext } from "react";
import { useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter();
const mono = loadMono();

export const fontSans = inter.fontFamily;
export const fontMono = mono.fontFamily;

/**
 * Brand palette derived from packages/web/app/globals.css (dark theme):
 *   --primary: oklch(0.65 0.15 145)  -> #4aa651
 *   --background: oklch(0.13 0.005 285)
 *   --accent: oklch(0.22 0.008 285)
 */
export type Palette = {
  background: string;
  surface: string;
  primary: string;
  primaryBright: string;
  text: string;
  muted: string;
};

export const defaultPalette: Palette = {
  background: "#08080b",
  surface: "#16161a",
  primary: "#4aa651",
  primaryBright: "#6ee07a",
  text: "#eeeeee",
  muted: "#8b8b93",
};

export const PaletteContext = createContext<Palette>(defaultPalette);

export const usePalette = (): Palette => useContext(PaletteContext);

/**
 * Layout helper so the same scenes work in 1080x1920 and 1920x1080.
 * `s` scales typography, `contentWidth` caps line length.
 */
export const useLayout = () => {
  const { width, height } = useVideoConfig();
  const isPortrait = height >= width;
  const s = isPortrait ? width / 1080 : height / 1080;
  return {
    isPortrait,
    s,
    width,
    height,
    contentWidth: isPortrait ? width * 0.86 : width * 0.72,
  };
};
