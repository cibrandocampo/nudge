// The decoder's WebAssembly binary, emitted by Vite as a local asset.
//
// zxing-wasm defaults its Emscripten `locateFile` to the jsDelivr CDN, which
// this app cannot use: a strict self-hosted deployment may have no outbound
// internet at all, and an offline PWA must never depend on a third-party host.
// Importing it with `?url` makes Vite emit the file next to the other build
// assets and hands us the hashed URL to point the module at.
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export const ZXING_WASM_URL = zxingWasmUrl

/** Runtime cache the service worker stores the decoder in (see `sw.js`). */
export const WASM_CACHE_NAME = 'nudge-wasm-cache'
