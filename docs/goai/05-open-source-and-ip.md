# Open source and intellectual-property boundary

This is an engineering inventory, not legal advice. `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_DEPENDENCIES.md`, the files under `apps/desktop/third_party/xiaotong`, and the notices bundled with the installer are the package-level sources of truth.

| Component | Origin / license | In semifinal product package | Redistribution / commercial boundary | Verifiable control |
| --- | --- | --- | --- | --- |
| Chroni application code | Chroni contributors, MIT (`LICENSE`) | Yes | MIT terms | Public repository and exact commit |
| Chroni application icon and hourglass mark | Chroni project assets | Yes | Treated as first-party project assets | electron-builder icon configuration |
| XIAOTONG visual frames and donation QR | XIAOTONG Desktop Pet; Apache-2.0 file plus project-specific additional terms | Yes, 219 dynamic frames | Attribution, link-back, unmodified license/additional terms, and a complete About view are mandatory. Paid, subscription, advertising, sponsorship, or other revenue-generating use requires prior written consent. | `product/xiaotong` build manifest, artifact verifier, package tests, About route, bundled licenses |
| Source Sans 3, Source Serif 4, Noto Sans SC, Noto Serif SC | Fontsource packages; SIL OFL 1.1 fonts | Yes | Redistribution under OFL and notices | Licenses bundled |
| Production JS dependencies | Individual package licenses | Yes | Per package | Generated inventory and lockfile |
| DeepSeek / OpenAI-compatible APIs | External service selected by the user or the managed gateway | No model weights | Provider terms and data policy apply | Model is optional; local validation remains authoritative |
| GOAI examples and benchmark | Synthetic Chroni-authored data, repository MIT unless noted | Yes | No personal records | Fixed-clock runner, schema and reports |
| Product screenshots | Real Chroni UI from the product build | Documentation only | Visible third-party attribution follows the same terms | Store capture and submission manifest |

## Semifinal build path

```bash
pnpm run package:submission:windows
node scripts/verify-desktop-artifact.mjs --platform=windows --variant=product
pnpm run submission:goai
```

The submission packager refuses an installer unless `apps/desktop/dist/build-manifest.json` reports `variant=product` and `petAssetMode=xiaotong`. It also requires the installer to be newer than the manifest and includes a real companion screenshot, the complete Apache-2.0 license, the unmodified additional terms, and the original project notice. This prevents the earlier failure mode where the neutral Chroni icon was packaged as the desktop companion.

## Attribution and About access

The XIAOTONG About content retains the original project name, author/contact information, source link, version, donation QR and license links. It is reachable from the main product within no more than two user interactions. The installer carries the same notices under its resources directory, and the final competition ZIP repeats them under `05_数据安全与合规/桌宠素材` for judge-side inspection.

## Distribution decision

The GOAI semifinal package is prepared for noncommercial competition review and free product evaluation. Chroni does not claim a separate commercial authorization for XIAOTONG. Before any paid app-store listing, subscription, advertising, sponsorship, paid deployment, or other commercial distribution, the team must obtain written consent from the licensor or replace the companion with assets whose commercial and redistribution rights are fully controlled by the project.
