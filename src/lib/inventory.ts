// "Apple iPhone 13 Pro 128GB" → "iPhone 13 Pro": drops the storage suffix and
// avoids repeating the brand when the model already starts with it.
export function phoneLabel(marque: string | null, model: string | null) {
  const brand      = (marque ?? '').trim()
  const cleanModel = (model ?? '').trim().replace(/\s*\d+(GB|TB)\s*$/i, '').trim()
  return cleanModel.toLowerCase().startsWith(brand.toLowerCase()) ? cleanModel : `${brand} ${cleanModel}`.trim()
}

export function countByResult(items: { resultat: string }[]) {
  return items.reduce((acc: Record<string, number>, i) => {
    acc[i.resultat] = (acc[i.resultat] ?? 0) + 1
    return acc
  }, {})
}
