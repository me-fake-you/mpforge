# MPForge Linter rule catalog

Version: `linter 0.2.0`
Ruleset: `mpforge-wechat-preflight/2026-09-01`

The engine is deterministic and does not call an LLM or the network. `ERROR`
blocks approval, `WARNING` must be shown to the reviewer, and `INFO` is
advisory. Every emitted diagnostic carries the full Round 2 schema documented
in `packages/linter/src/types.ts`.

Only `whitespace.trailing` and `paragraph.empty` have allowlisted safe fixes.
Their transaction creates a backup, writes, reparses, reruns all rules, and
rolls back on failure. No rule rewrites claims or removes author content.

## Frontmatter rules

| rule_id                                       | trigger                                                   |      severity | safe fix | example                | test         |
| --------------------------------------------- | --------------------------------------------------------- | ------------: | -------: | ---------------------- | ------------ |
| `frontmatter.{title,summary,author}.required` | required text absent                                      |         ERROR |       no | `title: ""`            | LINT-FIX-01  |
| `frontmatter.theme.required`                  | theme absent                                              |         ERROR |       no | no `theme`             | LINT-FIX-01  |
| `frontmatter.theme.unknown`                   | theme is not in the original registry                     |         ERROR |       no | `theme: copied-x`      | LINT-FIX-01  |
| `frontmatter.status.invalid`                  | unknown lifecycle status                                  |         ERROR |       no | `status: done`         | LINT-FM-01   |
| `frontmatter.slug.invalid`                    | slug violates project grammar                             |         ERROR |       no | `Bad Slug`             | LINT-FM-01   |
| `frontmatter.{id,slug}.path-conflict`         | identity disagrees with article path/input                |         ERROR |       no | id or slug changed     | LINT-FM-01   |
| `frontmatter.{id,slug}.duplicate`             | identity duplicates another project article               |         ERROR |       no | repeated UUID          | LINT-FM-01   |
| `frontmatter.{created_at,updated_at}.invalid` | timestamp is invalid                                      |         ERROR |       no | `yesterday`            | LINT-FM-01   |
| `frontmatter.updated_at.before-created`       | update precedes creation                                  |         ERROR |       no | reversed dates         | LINT-FM-01   |
| `frontmatter.cover.missing`                   | cover absent (WARNING) or configured path missing (ERROR) | WARNING/ERROR |       no | `assets/lost.png`      | LINT-FIX-02  |
| `frontmatter.account.missing`                 | publication preparation has no account                    |         ERROR |       no | empty account          | LINT-FM-02   |
| `frontmatter.original.required`               | `original` absent or not boolean                          |         ERROR |       no | `original: "true"`     | LINT-FM-01   |
| `frontmatter.boolean.string`                  | boolean field parsed as a string                          |         ERROR |       no | `ai_assisted: "false"` | LINT-FM-01   |
| `frontmatter.ai_tasks.invalid`                | AI task audit value has wrong shape                       |         ERROR |       no | `[1]`                  | LINT-FM-01   |
| `frontmatter.human-reviewed.status-conflict`  | reviewed/approved status lacks human flag                 |         ERROR |       no | reviewed + false       | LINT-FM-01   |
| `frontmatter.field.unknown`                   | preserved extension field                                 |          INFO |       no | `custom_x: 1`          | LINT-FM-01   |
| `frontmatter.{title,author,summary}.too-long` | official configured limit exceeded                        |         ERROR |       no | 33-char title          | LINT-PLAT-01 |
| `frontmatter.source-url.{invalid,too-long}`   | URL invalid or over official byte limit                   |         ERROR |       no | `file:///x`            | LINT-PLAT-01 |
| `frontmatter.approved.missing-record`         | approved has no independent approval record               |         ERROR |       no | status-only edit       | LINT-FM-01   |

## Content, link, and media rules

| rule_id                                  | trigger                                            |      severity | safe fix | example               | test           |
| ---------------------------------------- | -------------------------------------------------- | ------------: | -------: | --------------------- | -------------- |
| `content.body.empty`                     | no body text                                       |         ERROR |       no | blank body            | LINT-CONT-01   |
| `heading.h1.multiple`                    | more than one H1                                   |       WARNING |       no | two `#` headings      | LINT-CONT-01   |
| `heading.level.jump`                     | heading skips a level                              |       WARNING |       no | H2 to H4              | LINT-CONT-01   |
| `heading.body.missing`                   | heading has no following prose                     |       WARNING |       no | terminal heading      | LINT-CONT-01   |
| `heading.duplicate`                      | normalized heading repeats                         |       WARNING |       no | two “Results”         | LINT-CONT-01   |
| `paragraph.duplicate`                    | substantial paragraph repeats                      |       WARNING |       no | pasted paragraph      | LINT-CONT-01   |
| `paragraph.too-long`                     | paragraph exceeds configured length                |       WARNING |       no | unbroken essay        | LINT-CONT-01   |
| `paragraph.empty`                        | excessive empty paragraphs                         |          INFO |      yes | 3+ blank lines        | LINT-FIX-03    |
| `content.unbroken-run`                   | long English/code token run                        |       WARNING |       no | 110-char token        | LINT-FIX-04    |
| `content.{length,bytes}.exceeded`        | official content character/byte limit exceeded     |         ERROR |       no | oversized article     | LINT-PLAT-02   |
| `content.placeholder`                    | TODO/TBD/FIXME, `${...}`, or `{{...}}` remains     |         ERROR |       no | `TODO`                | LINT-CONT-02   |
| `content.{test-residue,debug-residue}`   | likely fixture/debug prose remains                 |       WARNING |       no | `console.log`         | LINT-CONT-02   |
| `content.ai-residue.possible`            | one of the four explicit AI-style phrases          |       WARNING |       no | “作为一个 AI”         | LINT-CONT-03   |
| `path.{absolute.local,machine-residue}`  | local absolute/machine path leaks                  |         ERROR |       no | Windows user path     | LINT-SEC-01    |
| `secret.possible`                        | deterministic dummy/credential-like secret pattern |         ERROR |       no | dummy `api_key=`      | LINT-SEC-02    |
| `link.target.empty`                      | Markdown link target empty                         |         ERROR |       no | `[x]()`               | LINT-LINK-01   |
| `link.local.missing`                     | registered local target absent                     |         ERROR |       no | `[x](lost.md)`        | LINT-LINK-01   |
| `link.file-uri`                          | `file://` link                                     |         ERROR |       no | local URI             | LINT-LINK-01   |
| `link.external`                          | external URL is reviewable                         |          INFO |       no | HTTPS source          | LINT-LINK-02   |
| `link.external.excessive`                | external-link configured maximum exceeded          |       WARNING |       no | link farm             | LINT-LINK-02   |
| `link.text.unrecognizable`               | external link lacks meaningful label               |       WARNING |       no | `[here](...)`         | LINT-LINK-02   |
| `quote.incomplete`                       | malformed quote marker                             |       WARNING |       no | bare `>`              | LINT-MD-01     |
| `footnote.reference.missing`             | footnote reference has no definition               |         ERROR |       no | `[^x]`                | LINT-MD-01     |
| `markdown.code-fence.unclosed`           | unmatched code fence                               |         ERROR |       no | missing closing fence | LINT-MD-01     |
| `markdown.structure.suspicious`          | malformed Markdown structure                       |       WARNING |       no | broken delimiter      | LINT-MD-01     |
| `table.too-wide`                         | configured column threshold exceeded               |       WARNING |       no | 7-column fixture      | LINT-FIX-05    |
| `code.overflow`                          | overlong code line                                 |       WARNING |       no | 110-char code line    | LINT-FIX-05    |
| `image.alt.missing`                      | image has empty alt                                |       WARNING |       no | `![](a.png)`          | LINT-MEDIA-01  |
| `image.local.missing`                    | local reference absent                             |         ERROR |       no | `assets/lost.png`     | LINT-FIX-02    |
| `image.external`                         | remote image not explicitly imported               |         ERROR |       no | HTTPS image           | LINT-MEDIA-02  |
| `image.embedded`                         | file/data/blob image input                         |         ERROR |       no | data URI              | LINT-SEC-03    |
| `image.{size,dimensions}.exceeded`       | byte/dimension policy exceeded                     |       WARNING |       no | huge image            | LINT-MEDIA-03  |
| `image.svg.unsafe`                       | media scanner reports unsafe SVG                   |         ERROR |       no | scripted SVG          | LINT-SEC-04    |
| `asset.rights.{blocked,pending,unknown}` | rights state is not publication-ready              | ERROR/WARNING |       no | pending license       | LINT-RIGHTS-01 |
| `asset.remote.source-url.missing`        | remote asset lacks origin URL                      |         ERROR |       no | remote + null         | LINT-RIGHTS-01 |
| `asset.attribution.missing`              | attribution-required asset lacks text              |         ERROR |       no | CC-BY + blank         | LINT-RIGHTS-01 |
| `build.determinism.unverified`           | second render evidence absent                      |       WARNING |       no | one render only       | LINT-BUILD-01  |
| `build.nondeterministic`                 | repeated HTML hashes differ                        |         ERROR |       no | timestamp in renderer | LINT-BUILD-01  |

## HTML/CSS stage rule families

Each family is evaluated independently for `raw`, `safe`, and `wechat`.
Replace `{phase}` with one of those values. This explicit expansion is why 111
rule families can produce up to 177 concrete stage-specific `rule_id` values.

| rule_id family                                                                       | trigger                                                     | severity | safe fix | example            | test           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------: | -------: | ------------------ | -------------- |
| `html.{phase}.tag.{script,iframe,object,embed,form,input,button,video,audio,canvas}` | risky tag present                                           |    ERROR |       no | `<script>`         | LINT-HTML-01   |
| `html.{phase}.event-handler`                                                         | `on*` attribute                                             |    ERROR |       no | `onclick=`         | LINT-HTML-01   |
| `html.{phase}.{javascript-url,data-url,external-javascript}`                         | executable/embedded URL or script source                    |    ERROR |       no | `javascript:`      | LINT-HTML-01   |
| `html.{phase}.external-stylesheet`                                                   | linked stylesheet                                           |    ERROR |       no | `rel=stylesheet`   | LINT-HTML-01   |
| `html.{phase}.external-font`                                                         | remote font dependency                                      |  WARNING |       no | font URL           | LINT-HTML-01   |
| `html.{phase}.unsafe-svg`                                                            | SVG script/event/external reference                         |    ERROR |       no | external `<image>` | LINT-HTML-01   |
| `html.{phase}.tag.unknown`                                                           | tag outside allowlist                                       |  WARNING |       no | `<widget>`         | LINT-HTML-02   |
| `html.{phase}.nesting.{invalid,unclosed}`                                            | mismatched/unclosed structure                               |  WARNING |       no | `</p>` mismatch    | LINT-HTML-02   |
| `css.{phase}.{expression,behavior,external-import}`                                  | executable/non-reproducible CSS                             |    ERROR |       no | `expression()`     | LINT-CSS-01    |
| `css.{phase}.{position-fixed,negative-margin}`                                       | unreliable/overflow-prone layout                            |  WARNING |       no | `position:fixed`   | LINT-CSS-01    |
| `css.{phase}.remote-background`                                                      | remote CSS image                                            |    ERROR |       no | `url(https:)`      | LINT-CSS-01    |
| `css.{phase}.variable-no-fallback`                                                   | CSS variable has no fallback                                |  WARNING |       no | `var(--x)`         | LINT-CSS-01    |
| `css.{phase}.fixed-width-overflow`                                                   | fixed width exceeds mobile config                           |  WARNING |       no | `width:900px`      | LINT-CSS-01    |
| `html.{phase}.{code,table}-overflow`                                                 | no mobile overflow fallback                                 |  WARNING |       no | plain `<pre>`      | LINT-FIX-05    |
| `html.{phase}.image-{max-width,height}`                                              | missing responsive width or huge height                     |  WARNING |       no | fixed 6000px       | LINT-HTML-03   |
| `accessibility.{phase}.contrast`                                                     | identical foreground/background pattern                     |  WARNING |       no | black on black     | LINT-A11Y-01   |
| `wechat.content-loss`                                                                | downgrade retains less than 70% of substantial visible text |    ERROR |       no | safe prose removed | LINT-WECHAT-01 |

## Reporter and transaction tests

- `LINT-REPORT-01`: stable JSON diagnostic ordering and fingerprints.
- `LINT-REPORT-02`: HTML escaping and summary counts.
- `LINT-REPORT-03`: SARIF 2.1.0 levels, locations, and fingerprints.
- `LINT-FIX-03`: safe-fix backup/write/reparse/rerun path.
- `LINT-FIX-ROLLBACK-01`: validation/write failure restores the original.
- `LINT-NET-01`: replacing global `fetch` proves lint performs zero requests.

The executable tests are in `packages/linter/src/*.test.ts`; fixture inputs are
in `packages/linter/src/__fixtures__/articles.ts`.
