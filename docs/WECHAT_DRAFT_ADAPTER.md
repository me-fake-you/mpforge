# WeChat draft adapter

The Round 3 provider surface is deliberately narrow:

- `getCapabilities`
- `validateConfiguration`
- `obtainAccessToken`
- `uploadBodyImage`
- `uploadCoverMaterial`
- `createDraft`
- `getDraft`
- `listDrafts`
- `findPossibleDraft`
- `sanitizeRequest`
- `sanitizeResponse`

Body images and cover materials are distinct operations. Body-image results replace local image URLs in the frozen HTML; the permanent cover identifier is bound to the draft payload. The provider owns request construction, response parsing, conservative limit checks, and recursive redaction. It does not own approval, idempotency, snapshot verification, or retries after an uncertain create response.

The contract was checked against current official WeChat developer documentation on 2026-09-01. See `reports/round3-wechat-official-contract.md` for URLs, fields, error categories, limits, and documented ambiguities. Contract verification is not live-account verification.

MPForge v0.1 creates at most a draft. Any later action in the WeChat administration console remains a separate human responsibility.
