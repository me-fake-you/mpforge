const sharedElements = `

## Elements

> A concise quotation keeps the article rhythm visible.

- One list item
- Another list item with **emphasis**

| Signal | Result |
| --- | ---: |
| Mobile width | Stable |

\`inline code\` and [a local-safe link](https://example.test/reference).

\`\`\`ts
const deterministic = true;
\`\`\`

---
`;

export const minimalPreviewFixture = `# Minimal field notes

A neutral long-form paragraph with calm spacing and a clear reading line.${sharedElements}`;

export const academicBluePreviewFixture = `# Reproducible classroom study

This fixture demonstrates a restrained hierarchy for research and education.${sharedElements}`;

export const warmEditorialPreviewFixture = `# An afternoon photo walk

Warm paper tones support reflective writing without competing with the story.${sharedElements}`;

export const techDarkAccentPreviewFixture = `# Build log: deterministic output

The article remains light while code and technical accents use focused dark surfaces.${sharedElements}`;
