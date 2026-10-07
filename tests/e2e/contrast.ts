import { expect, type Page } from '@playwright/test';

// Measures how easy text is to read, the way the eye meets it: each piece of text on screen is
// compared with the pixels actually behind it, so a tint, a faded parent or a new colour cannot
// quietly slip under the line. The line is WCAG AA: 4.5:1, or 3:1 for large text.

export interface Reading {
  text: string;
  ratio: number;
  size: number;
  /** Large text, which WCAG holds to 3:1 instead of 4.5:1. */
  large: boolean;
  /** Dimmed with opacity rather than set in a colour of its own. */
  faded: boolean;
}

/** Every piece of text on screen, with its contrast against what is really behind it. */
export async function read(page: Page): Promise<Reading[]> {
  // Nothing hovered, and every slide and fade finished.
  await page.mouse.move(5, 5);
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  const screenshot = (await page.screenshot()).toString('base64');

  return page.evaluate(async (png) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;

    /** The colour filling most of a box: its background, since text covers less than half of it. */
    const behind = (box: DOMRect) => {
      const counts = new Map<number, number>();
      for (let y = Math.max(0, Math.floor(box.top)); y < Math.min(image.height, Math.ceil(box.bottom)); y++) {
        for (let x = Math.max(0, Math.floor(box.left)); x < Math.min(image.width, Math.ceil(box.right)); x++) {
          const i = (y * image.width + x) * 4;
          const colour = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
          counts.set(colour, (counts.get(colour) ?? 0) + 1);
        }
      }
      const [most] = [...counts].sort((a, b) => b[1] - a[1])[0];
      return [(most >> 16) & 255, (most >> 8) & 255, most & 255];
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** Any CSS colour as red, green, blue and alpha. */
    const probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    const rgba = (colour: string) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = colour;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return a ? [(r * 255) / a, (g * 255) / a, (b * 255) / a, a / 255] : [0, 0, 0, 0];
    };

    const out = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent!.trim();
      const element = node.parentElement!;
      if (!text || seen.has(element)) continue;
      seen.add(element);
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || box.width < 2 || box.height < 2) continue;
      // On screen, and not underneath something else.
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!top || !(element === top || element.contains(top) || top.contains(element))) continue;

      let opacity = 1;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      const [r, g, b, a] = rgba(style.color);
      // Hidden on purpose, like the hour label that makes way for the current time.
      if (a * opacity === 0) continue;
      const background = behind(box);
      const ink = [r, g, b].map((v, i) => v * a * opacity + background[i] * (1 - a * opacity));
      const [lighter, darker] = [luminance(ink), luminance(background)].sort((x, y) => y - x);
      const size = parseFloat(style.fontSize);
      out.push({
        text: text.slice(0, 30),
        ratio: Math.round(((lighter + 0.05) / (darker + 0.05)) * 10) / 10,
        size,
        large: size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700),
        faded: opacity < 1,
      });
    }
    return out;
  }, screenshot);
}

/** Fails if anything on screen is hard to read, or is dimmed with opacity instead of given a colour. */
export async function check(page: Page, screen: string) {
  const readings = await read(page);
  expect(readings.length, `${screen}: text found`).toBeGreaterThan(10);
  const hard = readings.filter((r) => r.ratio < (r.large ? 3 : 4.5)).map((r) => `"${r.text}" ${r.ratio}:1 at ${r.size}px`);
  expect(hard, `${screen}: text that is hard to read`).toEqual([]);
  expect(readings.filter((r) => r.faded).map((r) => r.text), `${screen}: text dimmed with opacity`).toEqual([]);
  return readings;
}
