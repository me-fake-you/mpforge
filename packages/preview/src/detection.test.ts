import { describe, expect, it } from "vitest";
import { detectLayoutIssues } from "./detection.js";
import type { ElementSnapshot, LayoutSnapshot } from "./types.js";

const baseElement = (overrides: Partial<ElementSnapshot>): ElementSnapshot => ({
  selector: "main > p",
  parent_selector: "main",
  tag: "p",
  text: "Readable test text",
  rect: {
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    right: 100,
    bottom: 20,
    left: 0,
  },
  client_width: 100,
  client_height: 20,
  scroll_width: 100,
  scroll_height: 20,
  display: "block",
  visibility: "visible",
  opacity: 1,
  overflow_x: "visible",
  overflow_y: "visible",
  position: "static",
  color: "rgb(120, 120, 120)",
  background_color: "rgb(125, 125, 125)",
  font_size: 16,
  font_weight: 400,
  natural_width: null,
  natural_height: null,
  image_complete: null,
  image_has_transparency: null,
  image_average_luminance: null,
  image_analysis_error: null,
  ...overrides,
});

describe("detectLayoutIssues", () => {
  it("deterministically detects overflow, clipping, visibility, contrast, gaps, and image risks", () => {
    const snapshot: LayoutSnapshot = {
      viewport: { name: "phone-375", width: 375, height: 812 },
      document_scroll_width: 720,
      document_scroll_height: 4_000,
      body_scroll_width: 720,
      body_scroll_height: 4_000,
      elements: [
        baseElement({
          selector: "main > h1",
          tag: "h1",
          parent_selector: "main",
          rect: {
            x: 0,
            y: 40,
            width: 300,
            height: 60,
            top: 40,
            right: 300,
            bottom: 100,
            left: 0,
          },
        }),
        baseElement({
          selector: "header",
          tag: "header",
          parent_selector: "body",
          position: "fixed",
          rect: {
            x: 0,
            y: 30,
            width: 375,
            height: 50,
            top: 30,
            right: 375,
            bottom: 80,
            left: 0,
          },
        }),
        baseElement({
          selector: "main > table",
          tag: "table",
          parent_selector: "main",
          rect: {
            x: 0,
            y: 120,
            width: 700,
            height: 100,
            top: 120,
            right: 700,
            bottom: 220,
            left: 0,
          },
          client_width: 700,
          scroll_width: 700,
        }),
        baseElement({
          selector: "main > pre",
          tag: "pre",
          parent_selector: "main",
          rect: {
            x: 0,
            y: 240,
            width: 350,
            height: 80,
            top: 240,
            right: 350,
            bottom: 320,
            left: 0,
          },
          client_width: 350,
          scroll_width: 900,
          overflow_x: "hidden",
        }),
        baseElement({
          selector: "main > .hidden",
          parent_selector: "main",
          text: "Invisible secret",
          visibility: "hidden",
          rect: {
            x: 0,
            y: 340,
            width: 120,
            height: 20,
            top: 340,
            right: 120,
            bottom: 360,
            left: 0,
          },
        }),
        baseElement({
          selector: "main > img",
          tag: "img",
          parent_selector: "main",
          text: "",
          rect: {
            x: 0,
            y: 1_300,
            width: 400,
            height: 3_400,
            top: 1_300,
            right: 400,
            bottom: 4_700,
            left: 0,
          },
          client_width: 400,
          client_height: 3_400,
          scroll_width: 400,
          scroll_height: 3_400,
          natural_width: 10_000,
          natural_height: 10_000,
          image_complete: false,
          image_has_transparency: true,
          image_average_luminance: 0.1,
        }),
      ],
    };

    const result = detectLayoutIssues(snapshot, "dark");
    expect(result.horizontal_overflow).toBe(true);
    expect(result.table_overflow).toEqual(["main > table"]);
    expect(result.code_overflow).toEqual(["main > pre"]);
    expect(result.image_overflow).toEqual(["main > img"]);
    expect(result.content_clipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: "main > pre", axis: "horizontal" }),
      ]),
    );
    expect(result.invisible_text).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "main > .hidden",
          reason: "visibility",
        }),
      ]),
    );
    expect(result.heading_overlaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          heading: "main > h1",
          obstructing_element: "header",
        }),
      ]),
    );
    expect(result.contrast_warnings.length).toBeGreaterThan(0);
    expect(result.abnormal_blank_regions.length).toBeGreaterThan(0);
    expect(result.oversized_images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "main > img",
          reason: "pixel-count",
        }),
      ]),
    );
    expect(result.dark_transparent_image_risks).toEqual([
      expect.objectContaining({
        selector: "main > img",
        reason: "dark-content-on-transparency",
      }),
    ]);
    expect(result.missing_images).toEqual(["main > img"]);
  });
});
