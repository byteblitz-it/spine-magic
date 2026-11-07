# Vendored Spine Runtimes 3.8 (spine-ts)

Esoteric Software does not publish the 3.8 TypeScript runtime on npm, so the prebuilt files are vendored here,
unmodified, from the official repository:

- Source: https://github.com/EsotericSoftware/spine-runtimes, branch `3.8`
- Commit: `8b4844bd4b193ba9e54487ed397a777993cbad56`
- Files: `spine-ts/build/spine-core.js`, `spine-ts/build/spine-webgl.js`, and the repository `LICENSE`

| file | bytes | SHA-256 (first 16) |
|---|---|---|
| spine-core.js | 299,442 | `F1E0A31B9906E4D4` |
| spine-webgl.js | 422,151 | `4B108BAD314C152B` |

Used for: validating 3.8 exports and merged 3.8 characters (`spine-core.js`, in Node), sampling 3.8 bone
animation for trail-mode attachment, and previewing 3.8 characters in the web editor (`spine-webgl.js`,
which includes the core).

These files are licensed under the Spine Runtimes License (see `LICENSE` in this folder), not SpineMagic's
MIT license. Users of products that include them need their own Spine Editor license.
