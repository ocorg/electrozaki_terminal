import type { Code } from '@/lib/codes'

// Which problems belong to which kind of request (labels in codes.ts →
// repair_problem). Shared by the ticket form, the website-request conversion
// and the API validation.
export type RepairKind    = Code<'repair_kind'>
export type RepairProblem = Code<'repair_problem'>

export const PROBLEMS_BY_KIND: Record<RepairKind, RepairProblem[]> = {
  materiel:     ['ecran', 'batterie', 'camera', 'connecteur', 'son', 'reseau', 'autre_materiel'],
  logiciel:     ['systeme_bloque', 'mise_a_jour', 'donnees', 'compte_config'],
  consultation: ['consultation'],
}

export const REPAIR_KINDS: RepairKind[] = ['materiel', 'logiciel', 'consultation']

/** Same statuses, worded for an online consultation (no device in the shop). */
export const CONSULTATION_STATUS_LABEL: Record<string, { fr: string; ar: string }> = {
  en_attente:   { fr: 'À planifier',       ar: 'للبرمجة' },
  devis_envoye: { fr: 'Tarif proposé',     ar: 'تم اقتراح السعر' },
  en_cours:     { fr: 'En consultation',   ar: 'قيد الاستشارة' },
  pret:         { fr: 'Terminée — à régler', ar: 'منتهية — للأداء' },
  recupere:     { fr: 'Clôturée',          ar: 'مغلقة' },
}
