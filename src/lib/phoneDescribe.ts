import { codeLabel } from '@/lib/codes'

// One phone described so anyone knows which one it is: name, IMEI,
// storage/colour/battery or RAM/condition, defects and notes.
export type PhoneRow = {
  phone_id: string; marque: string; model: string; imei: string | null; stockage: string | null; ram: string | null
  couleur: string | null; battery_level: number | null; condition: string; is_damaged: boolean | null; damage_notes: string | null
  replaced_components: unknown; description: string | null; status: string; prix_achat: unknown; du_fournisseur: unknown
  origine_phone_id: string | null; settled_at: Date | null; created_at: Date | null; updated_at: Date | null
}

export function describePhone(p: PhoneRow) {
  const parts = [
    p.stockage, p.couleur,
    p.marque?.toLowerCase() === 'apple' ? (p.battery_level != null ? `batterie ${p.battery_level} %` : null) : (p.ram ? `RAM ${p.ram}` : null),
    p.marque?.toLowerCase() !== 'apple' && p.battery_level != null ? `batterie ${p.battery_level} %` : null,
    codeLabel('device_condition', p.condition as never, 'fr'),
  ].filter(Boolean)
  const issues = [
    p.is_damaged ? `endommagé${p.damage_notes ? ` : ${p.damage_notes}` : ''}` : null,
    Array.isArray(p.replaced_components) && p.replaced_components.length
      ? `pièces changées : ${(p.replaced_components as { name?: string }[]).map(c => c.name).join(', ')}` : null,
    p.description?.trim() ? `remarque : ${p.description.trim()}` : null,
  ].filter(Boolean)
  const name = p.model?.toLowerCase().startsWith((p.marque ?? '').toLowerCase()) ? p.model : `${p.marque} ${p.model}`
  return { phone_id: p.phone_id, name, imei: p.imei, specs: parts.join(' · '), issues: issues.join(' · ') || null }
}
