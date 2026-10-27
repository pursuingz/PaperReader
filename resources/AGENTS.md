# Local runtime resource rules
- `local-input/` contains pinned public local-inference assets and their preparation metadata.
- Every new resource directory receives AGENTS.md before assets. No papers, audio, frames, keys or user models belong here.
- Retain assets; the documented preparation script may overwrite a hash-verified generated asset with identical pinned content. Never delete.
- Source archives include metadata/licenses/scripts but exclude downloaded binary archives, native runtimes, WASM and models. Program builds copy runtime and vision assets explicitly.
