# Screenshot plan

Screenshots are release evidence, not decoration. Capture them only after the underlying scenario passes on the release candidate commit.

| ID  | Scene             | Required evidence                                     | Public-safe data          | Output                  |
| --- | ----------------- | ----------------------------------------------------- | ------------------------- | ----------------------- |
| S01 | Dashboard         | article rows, statuses, lint/build/receipt indicators | three repository examples | `dashboard.png`         |
| S02 | Editor            | Markdown, Frontmatter, theme selector, local asset    | comprehensive example     | `editor.png`            |
| S03 | Review            | diff/source/lint areas and zero-ERROR state           | educational example       | `review.png`            |
| S04 | Light preview     | current commit render, full title visible             | comprehensive example     | `preview-light.png`     |
| S05 | Dark preview      | same source and theme in dark mode                    | comprehensive example     | `preview-dark.png`      |
| S06 | Mobile preview    | 375px viewport, table and code readable               | comprehensive example     | `preview-mobile.png`    |
| S07 | Assets            | local path, size, abbreviated SHA-256, provenance     | original SVG only         | `assets.png`            |
| S08 | Publish gate      | approved status, account alias, preview summary       | `mock-local` alias        | `publish-gate.png`      |
| S09 | Mock receipt      | source/render/lint/assets hashes and success          | redacted local receipt    | `mock-receipt.png`      |
| S10 | Real safe failure | missing-credential error with no secret values        | synthetic alias           | `real-safe-failure.png` |
| S11 | Architecture      | repository SVG at readable scale                      | original diagram          | `architecture.png`      |
| S12 | Windows package   | installer filename and SHA-256 after successful build | no user paths             | `windows-artifact.png`  |

## Visual rules

- Use one OS theme consistently for UI shots; preview light/dark is the only deliberate mode switch.
- Keep browser/desktop chrome minimal and remove notifications.
- Do not show user-profile paths, environment variables, tokens, cookies, real account aliases, private Git remotes, or unrelated repositories.
- Crop without changing application content. Do not composite controls or invent success states.
- Preserve full-resolution PNGs. Build the demo GIF from copies.
- Record the source commit, viewport, command/scenario, and file SHA-256 in the release evidence.

## Acceptance

Every screenshot must be reviewed by a second person or QA agent for legibility, provenance, private data, and correspondence with the release commit. Missing scenes remain explicitly pending; no placeholder image is called a screenshot.
