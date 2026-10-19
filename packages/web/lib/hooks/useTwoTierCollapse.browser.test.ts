import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { fileURLToPath } from "node:url"

// Real hook, real layout/ResizeObserver behavior, mirroring the composer's
// actual structure: one shared row, a "left" group and a "right" group each
// with their own natural (labels shown) and collapsed (icon-only) hidden
// measurement twins.
let browser: Browser
let bundle: string
const root = fileURLToPath(new URL("../../../../", import.meta.url))
beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useTwoTierCollapse} from './packages/web/lib/hooks/useTwoTierCollapse';

      function Group({natRef, colRef, iconCount, label, visible, showLabel}) {
        const icons = Array.from({length: iconCount}, (_, i) => React.createElement('span', {key: i}, 'I'));
        return React.createElement(React.Fragment, null,
          visible && React.createElement('div', {id: visible, style: {display: 'flex', gap: '4px', whiteSpace: 'nowrap'}},
            ...icons, showLabel && React.createElement('span', null, label)),
          React.createElement('div', {ref: natRef, style: {position: 'fixed', left: 0, top: 0, visibility: 'hidden', display: 'flex', gap: '4px', whiteSpace: 'nowrap'}},
            ...icons, React.createElement('span', null, label)),
          React.createElement('div', {ref: colRef, style: {position: 'fixed', left: 0, top: 0, visibility: 'hidden', display: 'flex', gap: '4px', whiteSpace: 'nowrap'}},
            ...icons)
        );
      }

      function App() {
        const {containerRef, leftNaturalRef, leftCollapsedRef, rightNaturalRef, rightCollapsedRef, showLeft, showRight} = useTwoTierCollapse();
        window.state = {showLeft, showRight};
        return React.createElement('div', {id: 'row', ref: containerRef, style: {display: 'flex', gap: '8px', width: '300px'}},
          React.createElement(Group, {natRef: leftNaturalRef, colRef: leftCollapsedRef, iconCount: 1, label: window.leftLabel || 'left-label', visible: 'left', showLabel: showLeft}),
          React.createElement(Group, {natRef: rightNaturalRef, colRef: rightCollapsedRef, iconCount: 1, label: window.rightLabel || 'right-label', visible: 'right', showLabel: showRight})
        );
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    ` },
    alias: { react: `${root}/packages/web/node_modules/react`, "react-dom": `${root}/node_modules/react-dom` },
    bundle: true, platform: "browser", write: false, define: { "process.env.NODE_ENV": '"development"' },
  })
  bundle = result.outputFiles[0].text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })
afterEach(async () => {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) await page.unrouteAll({ behavior: "ignoreErrors" })
    await context.close()
  }
})

async function mount(leftLabel = "left-label", rightLabel = "right-label") {
  const page = await browser.newPage()
  await page.goto("data:text/html,<div id='root'></div>")
  await page.evaluate(({ l, r }) => {
    ;(window as unknown as { leftLabel: string; rightLabel: string }).leftLabel = l
    ;(window as unknown as { leftLabel: string; rightLabel: string }).rightLabel = r
  }, { l: leftLabel, r: rightLabel })
  await page.addScriptTag({ content: bundle })
  await page.waitForTimeout(150)
  return page
}

async function state(page: Page) {
  return page.evaluate(() => (window as unknown as { state: { showLeft: boolean; showRight: boolean } }).state)
}
async function rowWidth(page: Page, px: number) {
  await page.evaluate((w) => { document.getElementById("row")!.style.width = `${w}px` }, px)
  await page.waitForTimeout(150)
}

describe("useTwoTierCollapse (controlled browser)", () => {
  it("shows both labels when there's room for both", async () => {
    const page = await mount()
    expect(await state(page)).toEqual({ showLeft: true, showRight: true })
    await page.close()
  })

  it("collapses the right group first when space gets tight, leaving left expanded", async () => {
    const page = await mount()
    // Narrow enough that both labels don't fit, but left's full label plus
    // right's icon-only clearly does.
    await rowWidth(page, 100)
    expect(await state(page)).toEqual({ showLeft: true, showRight: false })
    await page.close()
  })

  it("collapses both groups only once right alone isn't enough", async () => {
    const page = await mount()
    await rowWidth(page, 10)
    expect(await state(page)).toEqual({ showLeft: false, showRight: false })
    await page.close()
  })

  it("re-expands right first as space returns, then is fully expanded again", async () => {
    const page = await mount()
    await rowWidth(page, 10)
    expect(await state(page)).toEqual({ showLeft: false, showRight: false })

    await rowWidth(page, 100)
    expect(await state(page)).toEqual({ showLeft: true, showRight: false })

    await rowWidth(page, 300)
    expect(await state(page)).toEqual({ showLeft: true, showRight: true })
    await page.close()
  })

  it("keeps the priority even when the right label is far longer than the left one", async () => {
    const page = await mount("l", "a-very-long-right-side-label-indeed")
    await rowWidth(page, 60)
    // However long content gets, right collapses before left ever does.
    const result = await state(page)
    expect(result.showRight).toBe(false)
    await page.close()
  })
})
