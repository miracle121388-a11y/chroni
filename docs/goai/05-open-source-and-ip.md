# Open source and intellectual-property boundary

This is an engineering inventory, not legal advice. `THIRD_PARTY_NOTICES.md` and the generated `THIRD_PARTY_DEPENDENCIES.md` are the package-level sources of truth.

| Component | Origin / license | In normal package | In GOAI `original` package | Redistribution / commercial boundary | Authorization state / switch |
| --- | --- | --- | --- | --- | --- |
| Chroni application code | Chroni contributors, MIT (`LICENSE`) | Yes | Yes | MIT terms | First-party repository code |
| Chroni hourglass mark | Chroni project asset | Yes | Yes | Treated as first-party project asset | Selected by `CHRONI_PET_ASSET_MODE=original` |
| XIAOTONG visual frames and donation QR | XIAOTONG Desktop Pet; Apache-2.0 file plus project-specific additional terms | Optional default visual mode | **No** | Additional terms restrict commercial/revenue use and require notices/About access | No separate competition/commercial authorization is claimed; omitted from GOAI build |
| Source Sans 3, Source Serif 4, Noto Sans SC, Noto Serif SC | Fontsource packages; SIL OFL 1.1 fonts | Yes | Yes | Redistribution under OFL and notices | Licenses bundled |
| Production JS dependencies | Individual package licenses | Yes | Yes | Per package | Generated inventory bundled; exact versions in lockfile |
| DeepSeek / OpenAI-compatible APIs | External service selected by user or managed gateway | No model weights | No model weights | Provider terms and data policy apply | Disabled until configured; no-key demo bypasses model |
| GOAI examples and benchmark | Synthetic Chroni-authored data, repository MIT unless noted | Source repository | Source repository | No personal records; reusable under repository license | Generated specifically for this project |
| Product screenshots | Real Chroni UI; may show optional XIAOTONG mode | Documentation only | Not a renderer/package dependency | Screenshot reuse must respect visible third-party asset terms | GOAI submission should capture `original` mode unless written rights are obtained |

## Safe build path

```bash
pnpm run build:goai
pnpm run goai:assets:check
pnpm run package:goai:windows
# or: pnpm run package:goai:macos
```

Vite resolves a virtual pet-asset module at build time. `original` mode imports only `apps/desktop/build/icon-source.svg`; the verifier rejects XIAOTONG/tongluv/donation paths and raster images in the built renderer. electron-builder conditionally omits all XIAOTONG resources while retaining Chroni, dependency, and font notices. Packaging tests load both configurations.

## About and optional mode

The normal XIAOTONG mode keeps attribution, version, author/contact, source link, additional terms, and donation image within the About route. The GOAI original mode replaces that block with an explicit safe-mode statement. Retaining optional mode does not imply the asset is MIT-licensed or approved for prize/commercial use.

## Release decision

GOAI and any prize, sponsorship, public campaign, or commercial demonstration should use `original` packages until verifiable written authorization covers that use. A future replacement character must include provenance and commercial/redistribution rights before entering this matrix.
