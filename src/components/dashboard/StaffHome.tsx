'use client'
import Link from 'next/link'
import { ShoppingCart, Vault, Smartphone, Package, Wrench, Users } from 'lucide-react'
import AttendanceWidget from '@/components/attendance/AttendanceWidget'

// An employee's home: clock in/out and their screens. No sales figures —
// those are managers' data (the dashboard API refuses staff).
export default function StaffHome({ storeId, portalBase, name, isAr }: {
  storeId: string
  portalBase: string
  name?: string | null
  isAr: boolean
}) {
  const L = (fr: string, ar: string) => (isAr ? ar : fr)
  const links = [
    { href: `${portalBase}/pos`,               icon: ShoppingCart, label: L('Point de vente', 'نقطة البيع'),   hint: L('Vendre, échanger', 'بيع، استبدال') },
    { href: `${portalBase}/caisse`,            icon: Vault,        label: L('Caisse du jour', 'صندوق اليوم'),  hint: L('Ouverture et clôture', 'فتح وإغلاق') },
    { href: `${portalBase}/stock/phones`,      icon: Smartphone,   label: L('Téléphones', 'الهواتف'),         hint: L('Consulter le stock', 'الاطلاع على المخزون') },
    { href: `${portalBase}/stock/accessories`, icon: Package,      label: L('Accessoires', 'الإكسسوارات'),    hint: L('Consulter le stock', 'الاطلاع على المخزون') },
    { href: `${portalBase}/repairs`,           icon: Wrench,       label: L('Réparations', 'الإصلاحات'),      hint: L('Tickets et suivi', 'التذاكر والمتابعة') },
    { href: `${portalBase}/clients`,           icon: Users,        label: L('Clients', 'العملاء'),            hint: L('Fiches et historique', 'البطاقات والسجل') },
  ]
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <AttendanceWidget storeId={storeId} />
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1A1A] tracking-wide">
          {L(`Bonjour${name ? `, ${name}` : ''}`, `مرحباً${name ? `، ${name}` : ''}`)}
        </h1>
        <p className="text-sm text-[#6B6860] mt-0.5">{L('Que voulez-vous faire ?', 'ماذا تريد أن تفعل؟')}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {links.map(({ href, icon: Icon, label, hint }) => (
          <Link key={href} href={href}
            className="bg-white border border-[#E8E5DE] rounded-2xl p-4 hover:border-[#C9A440] hover:shadow-sm active:scale-[0.99] transition-all">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#FAF5E8] mb-3">
              <Icon className="w-5 h-5 text-[#C9A440]" />
            </div>
            <p className="font-bold text-[#1A1A1A]">{label}</p>
            <p className="text-xs text-[#6B6860] mt-0.5">{hint}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
