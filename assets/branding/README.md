# Approved Body Anvil masters · #106

Supplied by the owner in `body-anvil-issue-106-assets.zip` on 9 November 2026. Archive SHA-256: `a64c8edf11ddd937b593b2ebfd3e276d745a44274d578d242ca23af665a70ce0`.

| Original file | Size / mode | SHA-256 |
|---|---|---|
| `body-anvil-approved-female-launcher-original.png` | 1254×1254 RGB | `48cdd6f32a6c647e75573862826359c06726c75e91d5d40c836556aeab251656` |
| `body-anvil-approved-female-launcher-1024.png` | 1024×1024 RGB | `cf67841fadeb0872b35de136c7b2894e7cbcd83c36ba58caace17fe6c6fb542a` |
| `body-anvil-approved-heroes.png` | 1254×1254 RGB | `c9a5bfba44110236c793ceef9acbc6c2e653b1607c25374654dca1cdb3b4a1bf` |

These three files retain their exact archive bytes. No AI image generation or replacement artwork was used. The supplied 1024px resample is preserved as received; production derivatives are regenerated from the original master.

`generated/` contains non-destructive derivatives:

- Female launcher: opaque 1024px app/iOS icon, RGBA 512px Play icon, 16/32/48/192px web icons.
- Adaptive: transparent 1080px padded foreground, intentional deep-purple background in Expo config, source-traced female silhouette for themed/monochrome icons. The approved colored hero image itself is not redrawn.
- Notification: 96px white-alpha chest-emblem extraction, cleaned of disconnected outline fragments. Expo generates the five native density sizes.
- Three-hero master: 1024px contained splash image, 1024×500 RGB feature graphic and 1600×900 RGB website/promotional export. Letterboxing preserves every hero and the original lettering.

Only connected near-black exterior corner pixels are filled with the adaptive backdrop in launcher derivatives. Foreground padding/edge feathering avoids a white backing plate and keeps hair/head/emblem visible. The masters remain untouched.

Reproduce with Python and **Pillow 13.x** installed:

```powershell
npm run branding:build
```

The script checks all master hashes before and after exporting and updates `manifest.json` with output checksums, sizes and modes. Store preparation validates these inputs and copies approved derivatives; it cannot silently restore the old anvil crop. To inspect native resources and make labeled previews, run `python scripts/inspect-branding.py` after Android prebuild and the Expo iOS icon-generator audit described in the issue evidence.
