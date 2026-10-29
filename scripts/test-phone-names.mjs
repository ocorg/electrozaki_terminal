// Unit checks of the phone naming rules (no database, no server):
//   node scripts/test-phone-names.mjs
import { fileURLToPath } from 'node:url'
import jitiFactory from 'jiti'  // jiti 1.x (installed with the project): runs the TypeScript files directly
const jiti = jitiFactory(fileURLToPath(import.meta.url))
const { phoneName } = jiti('../src/lib/storefront/listing.ts')
const { modelNameProblem, colourLooksEnglish } = jiti('../src/lib/phoneNaming.ts')

const results = []
const eq = (name, got, want) => results.push({ name, ok: got === want, got, want })

// Website name (phoneName)
eq('iPhone SE suffix model gets the whole series', phoneName({ marque: 'Apple', serie: 'iPhone SE', model: '(2nd generation)' }), 'iPhone SE (2nd generation)')
eq('short iPhone model keeps its name',            phoneName({ marque: 'Apple', serie: 'iPhone 13', model: '13 Pro' }), 'iPhone 13 Pro')
eq('short iPhone base model',                      phoneName({ marque: 'Apple', serie: 'iPhone 11', model: '11' }), 'iPhone 11')
eq('full iPhone model unchanged',                  phoneName({ marque: 'Apple', serie: 'iPhone 13', model: 'iPhone 13 Pro Max' }), 'iPhone 13 Pro Max')
eq('Redmi suffix shares its number',               phoneName({ marque: 'Xiaomi', serie: 'Redmi 9', model: '9AT' }), 'Redmi 9AT')
eq('Xiaomi T suffix',                              phoneName({ marque: 'Xiaomi', serie: 'Xiaomi 14T', model: '14T Pro' }), 'Xiaomi 14T Pro')
eq('brand-first model unchanged',                  phoneName({ marque: 'Samsung', serie: 'Galaxy A16', model: 'Samsung Galaxy A16 5G' }), 'Samsung Galaxy A16 5G')
eq('word model takes the family word',             phoneName({ marque: 'Xiaomi', serie: 'Redmi Note 13', model: 'Note 13 Pro' }), 'Redmi Note 13 Pro')

// Naming rule (phone form / catalogue warnings)
eq('Apple short model is flagged', !!modelNameProblem('Apple', '13 Pro'), true)
eq('Apple full model passes',      modelNameProblem('Apple', 'iPhone SE 2020'), null)
eq('suffix model is flagged',      !!modelNameProblem('Apple', '(2nd generation)'), true)
eq('Xiaomi without brand flagged', !!modelNameProblem('Xiaomi', 'Redmi 17'), true)
eq('Xiaomi with brand passes',     modelNameProblem('Xiaomi', 'Xiaomi Redmi 17'), null)
eq('brand match ignores case',     modelNameProblem('Samsung', 'samsung Galaxy A07'), null)

// Colours
eq('English colour flagged',   colourLooksEnglish('Midnight Black'), true)
eq('French colour passes',     colourLooksEnglish('Noir Fantôme'), false)
eq('French "Rose" passes',     colourLooksEnglish('Rose Pâle'), false)

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)}`}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
