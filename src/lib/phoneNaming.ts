// Phone naming rules (owner, 2026-10-29) — shared by the phone form, the
// catalogue and the tests. Model = brand + model ("Samsung Galaxy A16",
// "Xiaomi Redmi 17"); Apple models start with "iPhone" / "iPad", without
// "Apple". Colours are French, one name each ("Noir Fantôme", not "Phantom
// Black"): the website translates them into English, Arabic and Darija.

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** What is wrong with a model name, or null when it follows the rule. */
export function modelNameProblem(marque: string | null | undefined, model: string | null | undefined): string | null {
  const m = (model ?? '').trim()
  const b = (marque ?? '').trim()
  if (!m || !b) return null
  if (m.startsWith('(')) return 'Le modèle doit être complet, ex. « iPhone SE 2020 », pas « (2nd generation) »'
  if (norm(b) === 'apple') {
    return /^(iphone|ipad)\b/i.test(m) ? null : 'Un modèle Apple commence par « iPhone » (ou « iPad »), ex. « iPhone 13 Pro »'
  }
  return norm(m).startsWith(norm(b)) ? null : `Le modèle commence par la marque, ex. « ${b} ${m} »`
}

// English colour words typed by mistake (the French one in comments)
const ENGLISH_COLOUR_WORDS = new Set([
  'black', 'white', 'blue', 'green', 'red', 'pink', 'purple', 'gold', 'silver', 'gray', 'grey', 'yellow',
  'brown', 'midnight', 'deep', 'dark', 'light', 'sky', 'navy', 'ocean', 'sea', 'phantom', 'titanium', 'space',
  'cosmic', 'starry', 'starlight', 'mist', 'lavender', 'cloud', 'shadow', 'pearl', 'crystal', 'emerald',
  'forest', 'mint', 'cream', 'coral', 'sunset', 'twilight',
])

/** The colour looks English: the form suggests typing it in French. */
export function colourLooksEnglish(colour: string | null | undefined): boolean {
  return norm(colour).split(/[\s-]+/).some(w => ENGLISH_COLOUR_WORDS.has(w))
}
