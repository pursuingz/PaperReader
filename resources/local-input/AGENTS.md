# Local input assets
- `manifest.json` pins official HTTPS downloads, byte counts, SHA-256 and licenses. `licenses/` holds upstream licenses.
- `downloads/` retains the pinned runner archive; `whisper/` its Windows x64 CLI and required DLLs. `vision/` holds the packaged hand model; `vision/wasm/` is copied from the pinned project-local package.
- `models/` is development smoke-test cache only and excluded from source/program archives. User speech models are installed through the application model store.
- `scripts/prepare-local-input.mjs` is the only preparation command: it verifies before reuse, downloads exclusively to owned part names, and never executes arbitrary remote commands or deletes files.
- Never store audio/video/user documents. Preserve prior assets; metadata/version changes require explicit entries.
