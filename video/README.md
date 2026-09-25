# Promo video

A [Remotion](https://remotion.dev) promo for Background Agents, rendered in both
short-form (9:16) and widescreen (16:9).

| File | Format | Use |
|------|--------|-----|
| `out/promo-portrait.mp4` | 1080×1920, 21.5s | TikTok, Reels, Shorts |
| `out/promo-landscape.mp4` | 1920×1080, 21.5s | YouTube, X, LinkedIn |

## Editing

Every line of copy and the three brand colors are exposed as typed props
(`src/schema.ts`), so the video can be re-cut without touching the scenes:

```bash
cd video
npm install
npm run dev      # Remotion Studio — edit props in the right-hand panel
```

Re-render after editing:

```bash
npm run render             # portrait  -> out/promo-portrait.mp4
npm run render:landscape   # landscape -> out/promo-landscape.mp4
```

Rendering needs a headless Chromium. Remotion downloads it on first use
(`npx remotion browser ensure`); on a bare Debian/Ubuntu box also install
`libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
libpango-1.0-0 libcairo2 libatspi2.0-0`.

## Structure

```
src/
├── schema.ts          # Zod schema + default copy/colors
├── Root.tsx           # PromoPortrait + PromoLandscape compositions
├── Composition.tsx    # Scene order, durations, transitions
├── theme.ts           # Brand palette, fonts, portrait/landscape scaling
├── scenes/            # Hook, Brand, Code, Providers, Features, CTA
└── components/        # Background, AnimatedText, Logo, CodeWindow
```

Colors and fonts are taken from the web app's dark theme in
`packages/web/app/globals.css` (`--primary: oklch(0.65 0.15 145)` → `#4aa651`,
Inter + JetBrains Mono). Scenes size themselves off `useLayout()`, so the same
components fill either aspect ratio.
