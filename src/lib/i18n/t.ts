import { dict } from './dictionary'

type Entry = { ar: string; fr: string }

function resolve(path: string): Entry | undefined {
  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const p of parts) node = node?.[p]
  return node && typeof node.ar === 'string' && typeof node.fr === 'string' ? node : undefined
}

/**
 * t(isAr, 'common.cancel') — looks up a shared string from the dictionary.
 * Takes the caller's own `isAr` boolean (already derived from useLanguageStore in every
 * component) rather than a hook, so adopting it doesn't require restructuring existing
 * component state — just wrap the string lookup.
 * Falls back to the dotted key itself if not found, so a typo/missing entry is visibly
 * wrong in the UI instead of silently rendering blank.
 */
export function t(isAr: boolean, path: string): string {
  const entry = resolve(path)
  if (!entry) return path
  return isAr ? entry.ar : entry.fr
}
