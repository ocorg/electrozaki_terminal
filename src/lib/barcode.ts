/* eslint-disable @typescript-eslint/no-explicit-any */
// Barcode reading in the browser, shared by every scanner screen (POS /
// stock scan button, Documents IMEI scan, Inventaire).
//
// Chrome (Android, the shop tablet) has a native barcode reader. Safari on
// iPhone and Samsung Internet don't: they get the same kind of reader
// compiled to WebAssembly (ZXing-C++ via barcode-detector), served by the
// ERP itself from public/vendor (copied at install, scripts/copy-zxing-wasm.mjs).

export type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }

// What a phone box / IMEI label / product label can carry.
export const BARCODE_FORMATS = [
  'code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'pdf417',
]

export async function makeDetector(formats: string[] = BARCODE_FORMATS): Promise<{ detector: Detector; engine: 'native' | 'wasm' }> {
  const Native = (window as any).BarcodeDetector
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats()
      if (supported.includes('code_128')) {
        return { detector: new Native({ formats: formats.filter(f => supported.includes(f)) }), engine: 'native' }
      }
    } catch { /* fall through to the WebAssembly reader */ }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? '/vendor/zxing_reader.wasm' : prefix + path),
    },
  })
  return { detector: new BarcodeDetector({ formats: formats as any }) as unknown as Detector, engine: 'wasm' }
}

/**
 * The phone's main back lens ("environment" — chosen by the phone, not from
 * the device list: an iPhone lists up to 14 "cameras" and the first one
 * often can't focus up close), at a resolution fine enough for IMEI barcodes.
 */
export function openCamera(facing: 'environment' | 'user' = 'environment') {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  })
}

/**
 * Keeps refocusing (Android may otherwise stay blurry on a close label) and
 * zooms a little so the phone can stay far enough away to focus. Returns
 * what the phone supports, for torch / zoom controls.
 */
export async function tuneCamera(track: MediaStreamTrack) {
  const caps = ((track as any).getCapabilities?.() ?? {}) as any
  const advanced: any[] = []
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' })
  let zoom: { min: number; max: number; step: number; value: number } | null = null
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    const value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1.5))
    advanced.push({ zoom: value })
    zoom = { min: caps.zoom.min, max: Math.min(caps.zoom.max, 5), step: caps.zoom.step || 0.1, value }
  }
  if (advanced.length) await track.applyConstraints({ advanced }).catch(() => {})
  return { zoom, torch: Boolean(caps.torch) }
}
