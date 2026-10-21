import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { fileURLToPath } from "node:url"

// Real hook, real layout/ResizeObserver behavior — a fixed container-width
// breakpoint can't tell whether arbitrary-length content (a repo/branch
// name) actually fits, so this is tested against an actual browser instead
// of just asserting on class names.
let browser: Browser
let bundle: string
const root = fileURLToPath(new URL("../../../../", import.meta.url))
beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useCollapsibleLabel} from './packages/web/lib/hooks/useCollapsibleLabel';

      function Item({text}) {
        const {itemRef, measureRef, showLabel} = useCollapsibleLabel();
        window.lastShowLabel = showLabel;
        return React.createElement(React.Fragment, null,
          React.createElement('div', {
            ref: itemRef, id: 'item',
            style: {display: 'flex', gap: '4px', overflow: 'hidden', flexShrink: 1, minWidth: 0},
          },
            React.createElement('span', {style: {flexShrink: 0}}, 'ICON'),
            showLabel && React.createElement('span', {style: {whiteSpace: 'nowrap'}}, text)
          ),
          React.createElement('span', {
            ref: measureRef, id: 'measure',
            style: {position: 'fixed', left: 0, top: 0, visibility: 'hidden', display: 'flex', gap: '4px', whiteSpace: 'nowrap'},
          },
            React.createElement('span', null, 'ICON'),
            React.createElement('span', null, text)
          )
        );
      }

      function App() {
        const [text, setText] = React.useState(window.initialText || 'short');
        window.setLabelText = setText;
        // Item is a direct child of #row, matching real usage: the trigger
        // button/link is always a direct flex child of the composer row.
        return React.createElement('div', {id: 'row', style: {display: 'flex', width: '150px'}},
          React.createElement(Item, {text})
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

async function mount(initialText = "short") {
  const page = await browser.newPage()
  await page.goto("data:text/html,<div id='root'></div>")
  await page.evaluate((value) => { (window as unknown as { initialText: string }).initialText = value }, initialText)
  await page.addScriptTag({ content: bundle })
  await page.waitForTimeout(100)
  return page
}

async function itemText(page: Page) {
  return page.evaluate(() => document.getElementById("item")!.textContent)
}
async function rowWidth(page: Page, px: number) {
  await page.evaluate((w) => { document.getElementById("row")!.style.width = `${w}px` }, px)
  await page.waitForTimeout(150)
}
async function setText(page: Page, text: string) {
  await page.evaluate((value) => { (window as unknown as { setLabelText: (v: string) => void }).setLabelText(value) }, text)
  await page.waitForTimeout(150)
}

describe("useCollapsibleLabel (controlled browser)", () => {
  it("shows the label when it fits, hides it when the row shrinks, and restores it when space returns", async () => {
    const page = await mount("short")
    expect(await itemText(page)).toBe("ICONshort")

    await rowWidth(page, 50)
    expect(await itemText(page)).toBe("ICON")

    await rowWidth(page, 150)
    expect(await itemText(page)).toBe("ICONshort")
    await page.close()
  })

  it("collapses a long label that would otherwise wrap, without ever getting stuck hidden", async () => {
    const page = await mount("short")
    expect(await itemText(page)).toBe("ICONshort")

    // A label far longer than the row — the literal bug report: this must
    // not wrap or overflow, it must collapse to icon-only instead.
    await setText(page, "a-really-really-long-repository-name-that-would-wrap")
    expect(await itemText(page)).toBe("ICON")
    const overflow = await page.evaluate(() => {
      const row = document.getElementById("row")!
      return row.scrollWidth > row.clientWidth
    })
    expect(overflow).toBe(false)

    // Switching back to short content must re-expand it — collapsing must
    // not be a one-way, permanently-stuck state.
    await setText(page, "short")
    expect(await itemText(page)).toBe("ICONshort")
    await page.close()
  })
})
