# Third-Party Notices

Chroni's first-party source code is provided under the MIT License in `LICENSE`. That license does not automatically apply to third-party assets, fonts, APIs, models, or datasets listed below.

## Visual asset modes

### `original` mode

Set `CHRONI_PET_ASSET_MODE=original` for the GOAI competition-safe build. This mode uses the Chroni hourglass application mark from `apps/desktop/build/icon-source.svg` and does not bundle or render XIAOTONG character frames or its donation image. The mark is part of the Chroni project.

### `xiaotong` mode

The optional XIAOTONG mode uses visual assets derived from **XIAOTONG Desktop Pet / 蓝色小嗵**. Its source and notices are preserved in:

- `apps/desktop/third_party/xiaotong/LICENSE`
- `apps/desktop/third_party/xiaotong/ADDITIONAL_TERMS.md`
- `apps/desktop/third_party/xiaotong/README.md`

Those materials are subject to Apache License 2.0 plus project-specific additional terms, including commercial-use and attribution conditions. They must not be assumed to be covered by Chroni's MIT License. GOAI, prize, public-distribution, or commercial use requires a separate rights review or verifiable written authorization. Chroni does not claim that authorization in this repository.

## Fonts

Chroni uses Source Sans 3, Source Serif 4, Noto Sans SC, and Noto Serif SC through Fontsource packages. The fonts are distributed under the SIL Open Font License 1.1. See:

- `apps/desktop/third_party/fonts/OFL-1.1.txt`
- `apps/desktop/third_party/fonts/NOTICE.md`

## Runtime libraries

The application uses Electron, React, React DOM, Vite, TypeScript, Tesseract.js, Mammoth, pdf-parse, read-excel-file, electron-updater, and their transitive dependencies under their respective licenses. Exact dependency versions are fixed by `pnpm-lock.yaml`; the generated production inventory is committed as `THIRD_PARTY_DEPENDENCIES.md`. Run `pnpm run notices:generate` after dependency changes.

## Models and APIs

Chroni does not include model weights. Optional OpenAI-compatible services, including a user-configured endpoint or the managed beta gateway, remain subject to the selected provider's terms. Model calls are disabled unless the user enables and configures them. The no-key demo and local rules path do not require a model API.

## GOAI synthetic data

Files under `examples/goai/` and `benchmarks/goai-v1/` are synthetic, contain no real student records, and are published under the repository MIT License unless a fixture states otherwise.

This notice is an engineering inventory, not legal advice. When rights are unclear, Chroni excludes the material from the competition-safe build.
