# MPForge screenshots and demo

These public-safe images were generated from the local MPForge web application by Playwright with external HTTP responses blocked. The captured workspace is intentionally empty; no private article, credential, or user path appears in the images.

## Reproduce

```powershell
. .\scripts\env.ps1
$env:MPFORGE_SCREENSHOT_DIR = "docs/screenshots"
pnpm test:e2e

$env:PYTHONNOUSERSITE = "1"
$env:PYTHONPYCACHEPREFIX = (Resolve-Path ".cache").Path + "\python"
& <python-with-pillow> scripts\build-demo-gif.py docs\screenshots docs\screenshots\mpforge-demo.gif
```

The first command uses the Chromium archive registered in `downloads/MANIFEST.json`. The second step only combines the six PNGs into a 720×480 animated GIF; it does not add synthetic UI.

## SHA-256

| File                    | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `mpforge-demo.gif`      | `1d948c38718b9fbd6f13ece1886d7ca78d0b72aecc184060c248645c8a9f0d30` |
| `mpforge-dashboard.png` | `4d6b4a43e650d89a73b491005cea33ea99af8b9a0bd41d6c5878ad6d512997ac` |
| `mpforge-editor.png`    | `80ec4da1e43c58c481fa2ca1318c7e24c38a635e842b4ee5b558e4856259dbf1` |
| `mpforge-review.png`    | `5590444101e1fa0ff30e7192d476f2d0f50ea2c0eb560b039fd9a864bba4e880` |
| `mpforge-assets.png`    | `114c7fd85b31824acc76399ecdc12fdd818f15b3f0bb1bd83b0e4294c197c39b` |
| `mpforge-publish.png`   | `a1adc2b3a9727072c3a977d031f3ab32b9ad47db35b77b396e1a90c913bbb24b` |
| `mpforge-settings.png`  | `cf9ba13e2b4bda9db8161d956a767a4ee899f82b6aa01a43ba75b79ea6ab001f` |
