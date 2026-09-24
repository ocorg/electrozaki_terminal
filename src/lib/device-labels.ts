import { prisma } from '@/lib/db'

// "Apple iPhone 13 128Go · Noir" / "Chargeur · Oraimo" — one query per device type
export async function deviceLabels(rows: { device_type: string; device_id: string }[]) {
  const ids = (type: string) => rows.filter(r => r.device_type === type).map(r => r.device_id)
  const [phones, accessories, laptops] = await Promise.all([
    prisma.phones.findMany({ where: { phone_id: { in: ids('telephone') } }, select: { phone_id: true, marque: true, model: true, stockage: true, couleur: true } }),
    prisma.accessories.findMany({ where: { acc_id: { in: ids('accessoire') } }, select: { acc_id: true, nom: true, marque: true } }),
    prisma.laptops.findMany({ where: { laptop_id: { in: ids('laptop') } }, select: { laptop_id: true, marque: true, model: true, stockage: true } }),
  ])
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ')
  const labels = new Map<string, string>()
  for (const p of phones)      labels.set(p.phone_id,  join([p.marque, p.model, p.stockage, p.couleur && `· ${p.couleur}`]))
  for (const a of accessories) labels.set(a.acc_id,    join([a.nom, a.marque && `· ${a.marque}`]))
  for (const l of laptops)     labels.set(l.laptop_id, join([l.marque, l.model, l.stockage]))
  return labels
}
