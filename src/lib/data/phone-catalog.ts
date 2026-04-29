// ─────────────────────────────────────────────────────────
//  Electro Zaki — Phone Catalog
//  Local data: no external API needed
//  Colors are in French
// ─────────────────────────────────────────────────────────

export interface PhoneModel {
  model:   string
  colors:  string[]
  storage: string[]   // common storage configs for this model
}

export interface PhoneBrand {
  brand:  string
  models: PhoneModel[]
}

// ── Shared color palettes ──────────────────────────────────
const COLORS_GENERIC   = ['Noir', 'Blanc', 'Bleu', 'Vert', 'Rouge', 'Or', 'Argent', 'Violet', 'Rose', 'Gris', 'Orange', 'Jaune']
const COLORS_SAMSUNG_S = ['Noir Fantôme', 'Violet Lavande', 'Crème', 'Vert Citron', 'Bleu Glacier', 'Bleu Saphir', 'Gris Graphite', 'Blanc Crème', 'Orange']
const COLORS_XIAOMI    = ['Noir', 'Blanc', 'Bleu', 'Vert', 'Or', 'Argent', 'Gris', 'Violet', 'Rose', 'Vert Émeraude', 'Bleu Glacier']

export const PHONE_CATALOG: PhoneBrand[] = [

  // ── APPLE ──────────────────────────────────────────────
  {
    brand: 'Apple',
    models: [
      // iPhone 16 series
      { model: 'iPhone 16 Pro Max',  colors: ['Titane Noir', 'Titane Blanc', 'Titane Naturel', 'Titane Désert'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'iPhone 16 Pro',      colors: ['Titane Noir', 'Titane Blanc', 'Titane Naturel', 'Titane Désert'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 16 Plus',     colors: ['Noir', 'Blanc', 'Rose', 'Bleu Outremer', 'Vert Menthe', 'Lumière Ultraviolette'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 16',          colors: ['Noir', 'Blanc', 'Rose', 'Bleu Outremer', 'Vert Menthe', 'Lumière Ultraviolette'], storage: ['128GB', '256GB', '512GB'] },

      // iPhone 15 series
      { model: 'iPhone 15 Pro Max',  colors: ['Titane Noir', 'Titane Blanc', 'Titane Naturel', 'Titane Bleu'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'iPhone 15 Pro',      colors: ['Titane Noir', 'Titane Blanc', 'Titane Naturel', 'Titane Bleu'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 15 Plus',     colors: ['Noir', 'Bleu', 'Vert', 'Jaune', 'Rose'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 15',          colors: ['Noir', 'Bleu', 'Vert', 'Jaune', 'Rose'], storage: ['128GB', '256GB', '512GB'] },

      // iPhone 14 series
      { model: 'iPhone 14 Pro Max',  colors: ['Noir Spatial', 'Argent', 'Or', 'Violet Profond'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 14 Pro',      colors: ['Noir Spatial', 'Argent', 'Or', 'Violet Profond'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 14 Plus',     colors: ['Minuit', 'Lumière Stellaire', 'Bleu', 'Violet', 'Product Red'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 14',          colors: ['Minuit', 'Lumière Stellaire', 'Bleu', 'Violet', 'Product Red'], storage: ['128GB', '256GB', '512GB'] },

      // iPhone 13 series
      { model: 'iPhone 13 Pro Max',  colors: ['Graphite', 'Or', 'Argent', 'Bleu Alpin', 'Vert Forêt'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 13 Pro',      colors: ['Graphite', 'Or', 'Argent', 'Bleu Alpin', 'Vert Forêt'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'iPhone 13 mini',     colors: ['Minuit', 'Lumière Stellaire', 'Rouge', 'Bleu', 'Rose', 'Vert'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 13',          colors: ['Minuit', 'Lumière Stellaire', 'Rouge', 'Bleu', 'Rose', 'Vert'], storage: ['128GB', '256GB', '512GB'] },

      // iPhone 12 series
      { model: 'iPhone 12 Pro Max',  colors: ['Graphite', 'Argent', 'Or', 'Bleu Pacifique'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 12 Pro',      colors: ['Graphite', 'Argent', 'Or', 'Bleu Pacifique'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'iPhone 12 mini',     colors: ['Noir', 'Blanc', 'Rouge', 'Vert', 'Bleu', 'Violet'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'iPhone 12',          colors: ['Noir', 'Blanc', 'Rouge', 'Vert', 'Bleu', 'Violet'], storage: ['64GB', '128GB', '256GB'] },

      // iPhone 11 series
      { model: 'iPhone 11 Pro Max',  colors: ['Gris Sidéral', 'Argent', 'Or Nuit', 'Vert Nuit'], storage: ['64GB', '256GB', '512GB'] },
      { model: 'iPhone 11 Pro',      colors: ['Gris Sidéral', 'Argent', 'Or Nuit', 'Vert Nuit'], storage: ['64GB', '256GB', '512GB'] },
      { model: 'iPhone 11',          colors: ['Noir', 'Blanc', 'Rouge', 'Vert', 'Jaune', 'Violet'], storage: ['64GB', '128GB', '256GB'] },

      // Older models
      { model: 'iPhone XS Max',      colors: ['Gris Sidéral', 'Argent', 'Or'], storage: ['64GB', '256GB', '512GB'] },
      { model: 'iPhone XS',          colors: ['Gris Sidéral', 'Argent', 'Or'], storage: ['64GB', '256GB', '512GB'] },
      { model: 'iPhone XR',          colors: ['Noir', 'Blanc', 'Bleu', 'Jaune', 'Corail', 'Rouge'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'iPhone X',           colors: ['Argent', 'Gris Sidéral'], storage: ['64GB', '256GB'] },
      { model: 'iPhone 8 Plus',      colors: ['Argent', 'Or', 'Gris Sidéral', 'Or Rose', 'Product Red'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'iPhone 8',           colors: ['Argent', 'Or', 'Gris Sidéral', 'Or Rose', 'Product Red'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'iPhone 7 Plus',      colors: ['Noir', 'Noir Jais', 'Argent', 'Or', 'Or Rose', 'Rouge'], storage: ['32GB', '128GB', '256GB'] },
      { model: 'iPhone 7',           colors: ['Noir', 'Noir Jais', 'Argent', 'Or', 'Or Rose', 'Rouge'], storage: ['32GB', '128GB', '256GB'] },
      { model: 'iPhone SE (3e gén)', colors: ['Minuit', 'Lumière Stellaire', 'Product Red'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'iPhone SE (2e gén)', colors: ['Noir', 'Blanc', 'Product Red'], storage: ['64GB', '128GB', '256GB'] },
    ],
  },

  // ── SAMSUNG ────────────────────────────────────────────
  {
    brand: 'Samsung',
    models: [
      // S25 series
      { model: 'Galaxy S25 Ultra',   colors: ['Titane Noir', 'Titane Gris', 'Titane Argent Bleu', 'Titane Blanc'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Galaxy S25+',        colors: ['Noir Stellaire', 'Bleu Glacier', 'Blanc Nacré', 'Argent Lunaire'], storage: ['256GB', '512GB'] },
      { model: 'Galaxy S25',         colors: ['Noir Stellaire', 'Bleu Glacier', 'Blanc Nacré', 'Corail Nuage'], storage: ['128GB', '256GB', '512GB'] },

      // S24 series
      { model: 'Galaxy S24 Ultra',   colors: ['Titane Noir', 'Titane Gris', 'Titane Violet', 'Titane Jaune', 'Titane Orange'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Galaxy S24+',        colors: ['Noir Cobalt', 'Gris Marbre', 'Violet Ronéo', 'Jaune Ambre'], storage: ['256GB', '512GB'] },
      { model: 'Galaxy S24',         colors: ['Noir Cobalt', 'Gris Marbre', 'Violet Ronéo', 'Jaune Ambre', 'Bleu Saphir', 'Vert Jade', 'Crème'], storage: ['128GB', '256GB'] },

      // S23 series
      { model: 'Galaxy S23 Ultra',   colors: ['Vert Botanique', 'Crème', 'Lavande', 'Noir Fantôme'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Galaxy S23+',        colors: ['Vert Botanique', 'Crème', 'Lavande', 'Noir Fantôme'], storage: ['256GB', '512GB'] },
      { model: 'Galaxy S23',         colors: ['Vert Botanique', 'Crème', 'Lavande', 'Noir Fantôme', 'Lime', 'Bleu Glacier', 'Rose Coton'], storage: ['128GB', '256GB'] },

      // S22 series
      { model: 'Galaxy S22 Ultra',   colors: ['Noir Fantôme', 'Blanc Fantôme', 'Bordeaux', 'Vert Foncé'], storage: ['128GB', '256GB', '512GB', '1TB'] },
      { model: 'Galaxy S22+',        colors: ['Noir Fantôme', 'Blanc Fantôme', 'Violet', 'Or Rose'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy S22',         colors: ['Noir Fantôme', 'Blanc Fantôme', 'Violet', 'Or Rose', 'Crème', 'Vert Foncé', 'Bleu Ciel', 'Graphite'], storage: ['128GB', '256GB'] },

      // A series
      { model: 'Galaxy A55',         colors: ['Bleu Glacé', 'Noir', 'Or Citrin', 'Blanc Crème'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A54',         colors: ['Vert Chartreuse', 'Graphite', 'Blanc', 'Violet'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A35',         colors: ['Bleu Marine', 'Jaune Citron', 'Lilas', 'Graphite'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A34',         colors: ['Vert', 'Graphite', 'Argent', 'Violet'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A25',         colors: ['Bleu Foncé', 'Bleu Glacier', 'Jaune'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A15',         colors: ['Bleu Clair', 'Bleu', 'Noir', 'Jaune'], storage: ['128GB', '256GB'] },
      { model: 'Galaxy A14',         colors: ['Noir', 'Argent', 'Vert Clair', 'Or Cuivré'], storage: ['64GB', '128GB'] },
      { model: 'Galaxy A05s',        colors: ['Noir', 'Vert', 'Or Rose'], storage: ['64GB', '128GB'] },
      { model: 'Galaxy A05',         colors: ['Noir', 'Argent', 'Bleu Glacier'], storage: ['64GB', '128GB'] },

      // Note / Fold / Flip
      { model: 'Galaxy Z Fold 6',    colors: ['Argent', 'Noir', 'Bleu', 'Blanc'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Galaxy Z Fold 5',    colors: ['Crème', 'Bleu Icy', 'Noir Fantôme'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Galaxy Z Flip 6',    colors: ['Jaune', 'Bleu', 'Argent', 'Gris'], storage: ['256GB', '512GB'] },
      { model: 'Galaxy Z Flip 5',    colors: ['Crème', 'Graphite', 'Vert Menthe', 'Lavande', 'Bleu'], storage: ['256GB', '512GB'] },
    ],
  },

  // ── XIAOMI ─────────────────────────────────────────────
  {
    brand: 'Xiaomi',
    models: [
      { model: 'Xiaomi 14 Ultra',    colors: ['Noir', 'Blanc', 'Titane Gris'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Xiaomi 14 Pro',      colors: ['Noir', 'Blanc', 'Titane'], storage: ['256GB', '512GB'] },
      { model: 'Xiaomi 14',          colors: ['Noir', 'Blanc', 'Vert Jade', 'Or Rose'], storage: ['256GB', '512GB'] },
      { model: 'Xiaomi 13 Ultra',    colors: ['Noir', 'Blanc', 'Vert Olive', 'Or'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Xiaomi 13 Pro',      colors: ['Noir Céramique', 'Blanc Céramique', 'Vert Montagne'], storage: ['256GB', '512GB'] },
      { model: 'Xiaomi 13',          colors: ['Noir', 'Blanc', 'Vert Menthe'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi 13T Pro',     colors: ['Noir Alpin', 'Blanc Alpin', 'Vert Méditerranée'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Xiaomi 13T',         colors: ['Noir Alpin', 'Bleu Alpin', 'Vert Méditerranée'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi 12 Pro',      colors: ['Bleu', 'Violet', 'Gris'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi 12',          colors: ['Bleu', 'Vert', 'Gris', 'Violet'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi 11T Pro',     colors: ['Blanc Céleste', 'Gris Météorite', 'Bleu Comète'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'Xiaomi 11T',         colors: ['Blanc Lune', 'Gris Météorite', 'Bleu Comète'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi Note 13 Pro+',colors: ['Noir', 'Blanc', 'Vert Aurora', 'Violet Zephyr'], storage: ['256GB', '512GB'] },
      { model: 'Xiaomi Note 13 Pro', colors: ['Noir', 'Blanc', 'Or Rose', 'Vert Aurora'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'Xiaomi Note 13',     colors: ['Noir', 'Blanc', 'Vert', 'Or'], storage: ['128GB', '256GB'] },
      { model: 'Xiaomi Note 12',     colors: ['Bleu Polaire', 'Onyx Gris', 'Blanc'], storage: ['128GB', '256GB'] },
    ],
  },

  // ── REDMI ──────────────────────────────────────────────
  {
    brand: 'Redmi',
    models: [
      { model: 'Redmi Note 13 Pro+', colors: ['Noir', 'Blanc Neige', 'Violet Aurora', 'Vert Méditerranée'], storage: ['256GB', '512GB'] },
      { model: 'Redmi Note 13 Pro',  colors: ['Noir', 'Blanc', 'Or Rose', 'Vert'], storage: ['128GB', '256GB', '512GB'] },
      { model: 'Redmi Note 13',      colors: ['Noir', 'Blanc', 'Or', 'Bleu Glacier'], storage: ['128GB', '256GB'] },
      { model: 'Redmi Note 12 Pro+', colors: ['Noir', 'Blanc', 'Bleu Polaire'], storage: ['256GB', '512GB'] },
      { model: 'Redmi Note 12 Pro',  colors: ['Noir', 'Blanc', 'Bleu Glacier', 'Or Rose'], storage: ['128GB', '256GB'] },
      { model: 'Redmi Note 12',      colors: ['Bleu Polaire', 'Onyx Gris', 'Blanc'], storage: ['128GB', '256GB'] },
      { model: 'Redmi Note 11 Pro',  colors: ['Blanc Polaire', 'Bleu Atlantique', 'Gris Graphite'], storage: ['128GB'] },
      { model: 'Redmi Note 11',      colors: ['Gris Graphite', 'Bleu Twi', 'Blanc Étoile', 'Crépuscule'], storage: ['64GB', '128GB'] },
      { model: 'Redmi 13',           colors: ['Noir', 'Bleu Glacier', 'Or Rose', 'Argent'], storage: ['128GB', '256GB'] },
      { model: 'Redmi 13C',          colors: ['Vert Clover', 'Bleu Marine', 'Noir Minuit'], storage: ['64GB', '128GB', '256GB'] },
      { model: 'Redmi 12',           colors: ['Bleu Midnight', 'Polar Silver', 'Sky Blue'], storage: ['128GB', '256GB'] },
      { model: 'Redmi 12C',          colors: ['Bleu Océan', 'Gris Graphite', 'Violet Lavande'], storage: ['32GB', '64GB', '128GB'] },
      { model: 'Redmi A3',           colors: ['Noir', 'Vert', 'Or'], storage: ['64GB', '128GB'] },
      { model: 'Redmi A2',           colors: ['Noir', 'Vert', 'Bleu'], storage: ['32GB', '64GB'] },
    ],
  },

  // ── HUAWEI ─────────────────────────────────────────────
  {
    brand: 'Huawei',
    models: [
      { model: 'P60 Pro',            colors: ['Noir', 'Blanc', 'Vert Rockery', 'Or Rocaille'], storage: ['256GB', '512GB'] },
      { model: 'P50 Pro',            colors: ['Noir', 'Blanc', 'Or', 'Bleu'], storage: ['128GB', '256GB'] },
      { model: 'P50',                colors: ['Noir', 'Blanc', 'Or', 'Bleu'], storage: ['128GB', '256GB'] },
      { model: 'Nova 12 Pro',        colors: ['Noir', 'Blanc', 'Or'], storage: ['256GB', '512GB'] },
      { model: 'Nova 11 Pro',        colors: ['Noir', 'Or', 'Vert'], storage: ['128GB', '256GB'] },
      { model: 'Nova 11',            colors: ['Noir', 'Blanc', 'Vert Menthe'], storage: ['128GB', '256GB'] },
      { model: 'Nova 10 Pro',        colors: ['Noir', 'Or Étoile', 'Bleu'], storage: ['128GB', '256GB'] },
      { model: 'Mate 60 Pro',        colors: ['Noir', 'Blanc', 'Vert', 'Gris'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Y90',                colors: ['Noir', 'Bleu Glacier'], storage: ['128GB'] },
    ],
  },

  // ── OPPO ───────────────────────────────────────────────
  {
    brand: 'Oppo',
    models: [
      { model: 'Find X7 Ultra',      colors: ['Noir', 'Blanc'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'Find X6 Pro',        colors: ['Brun', 'Noir'], storage: ['256GB', '512GB'] },
      { model: 'Reno 11 Pro',        colors: ['Bleu Misty', 'Brun Cuivré'], storage: ['256GB', '512GB'] },
      { model: 'Reno 11',            colors: ['Bleu Misty', 'Brun Sablé', 'Vert Palmier'], storage: ['128GB', '256GB'] },
      { model: 'Reno 10 Pro+',       colors: ['Gris Sylvestre', 'Or Glacier'], storage: ['256GB', '512GB'] },
      { model: 'Reno 10 Pro',        colors: ['Gris Sylvestre', 'Violet Perlé', 'Or Glacier'], storage: ['256GB'] },
      { model: 'Reno 10',            colors: ['Bleu Glacier', 'Gris Sylvestre', 'Or'], storage: ['128GB', '256GB'] },
      { model: 'A98',                colors: ['Bleu Saphir', 'Vert Émeraude'], storage: ['256GB'] },
      { model: 'A78',                colors: ['Aqua Vert', 'Noir', 'Bleu'], storage: ['128GB', '256GB'] },
      { model: 'A58',                colors: ['Vert', 'Bleu', 'Noir'], storage: ['128GB'] },
      { model: 'A38',                colors: ['Bleu Glacier', 'Or'], storage: ['128GB'] },
      { model: 'A18',                colors: ['Or', 'Bleu', 'Noir'], storage: ['64GB', '128GB'] },
    ],
  },

  // ── REALME ─────────────────────────────────────────────
  {
    brand: 'Realme',
    models: [
      { model: 'GT 6 Pro',           colors: ['Blanc Titane', 'Gris Titane'], storage: ['256GB', '512GB', '1TB'] },
      { model: 'GT 6',               colors: ['Vert Pluie', 'Bleu Titan', 'Blanc Nuage'], storage: ['256GB', '512GB'] },
      { model: 'GT 5 Pro',           colors: ['Blanc', 'Noir', 'Bleu'], storage: ['128GB', '256GB', '512GB'] },
      { model: '12 Pro+',            colors: ['Marbre Beige', 'Navigation Blue', 'Pearl White'], storage: ['256GB', '512GB'] },
      { model: '12 Pro',             colors: ['Bleu Saphir', 'Blanc Nacré', 'Coral Red'], storage: ['128GB', '256GB'] },
      { model: '12+',                colors: ['Vert Pionnier', 'Bleu Saphir', 'Gris Rêve'], storage: ['128GB', '256GB'] },
      { model: 'Note 50',            colors: ['Bleu', 'Or', 'Noir'], storage: ['64GB', '128GB'] },
      { model: 'C67',                colors: ['Bleu', 'Or', 'Noir'], storage: ['128GB', '256GB'] },
      { model: 'C55',                colors: ['Pluvieux Nuit', 'Perle Lumière', 'Or Rose'], storage: ['128GB', '256GB'] },
      { model: 'C35',                colors: ['Vert', 'Or', 'Bleu Glacier'], storage: ['64GB', '128GB'] },
    ],
  },

  // ── AUTRE ──────────────────────────────────────────────
  {
    brand: 'Autre',
    models: [
      { model: 'Autre', colors: COLORS_GENERIC, storage: ['32GB', '64GB', '128GB', '256GB', '512GB'] },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────

export function getModelsForBrand(brand: string): PhoneModel[] {
  return PHONE_CATALOG.find(b => b.brand === brand)?.models ?? []
}

export function getColorsForModel(brand: string, model: string): string[] {
  const models = getModelsForBrand(brand)
  return models.find(m => m.model === model)?.colors ?? COLORS_GENERIC
}

export function getStorageForModel(brand: string, model: string): string[] {
  const models = getModelsForBrand(brand)
  return models.find(m => m.model === model)?.storage ?? ['64GB', '128GB', '256GB', '512GB']
}

export const ALL_BRANDS = PHONE_CATALOG.map(b => b.brand)