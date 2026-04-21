'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useLanguageStore } from '@/lib/stores/language'
import { formatDate } from '@/lib/utils'
import { PageHeader, SkeletonRow, Modal, Field, inputClass, selectClass, Btn } from '@/components/shared'
import { toast } from 'sonner'
import { Users, Shield, Edit2, CheckCircle, XCircle, RefreshCw } from 'lucide-react'

interface UserProfile {
  id:           string
  display_name: string
  role:         string
  store_id:     string | null
  store_locked: boolean
  is_active:    boolean
  avatar_url:   string | null
  created_at:   string
}

const STORES = [
  { id: 'EZ-001', name: 'Electro Zaki', color: '#C9A440' },
  { id: 'HP-001', name: 'Hamid Phone',  color: '#0EA5E9' },
]

const ROLE_STYLES: Record<string, string> = {
  owner:   'bg-purple-50 text-purple-700 border-purple-200',
  manager: 'bg-blue-50 text-blue-700 border-blue-200',
  staff:   'bg-slate-50 text-slate-600 border-slate-200',
}

export default function BZGUsersPage() {
  const { user: self }  = useUser()
  const { language }    = useLanguageStore()
  const isAr            = language === 'ar'

  const [users, setUsers]         = useState<UserProfile[]>([])
  const [loading, setLoading]     = useState(true)
  const [editUser, setEditUser]   = useState<UserProfile | null>(null)
  const [form, setForm]           = useState({ display_name: '', role: '', store_id: '', store_locked: false, is_active: true })
  const [submitting, setSubmitting] = useState(false)

  async function fetchUsers() {
    setLoading(true)
    try {
      const res  = await fetch('/api/users')
      const json = await res.json()
      setUsers(json.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

  function openEdit(u: UserProfile) {
    setEditUser(u)
    setForm({
      display_name: u.display_name,
      role:         u.role,
      store_id:     u.store_id ?? '',
      store_locked: u.store_locked,
      is_active:    u.is_active,
    })
  }

  async function handleSave() {
    if (!editUser) return
    setSubmitting(true)
    try {
      const res  = await fetch('/api/users', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:           editUser.id,
          display_name: form.display_name,
          role:         form.role,
          store_id:     form.store_id || null,
          store_locked: form.store_locked,
          is_active:    form.is_active,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isAr ? 'تم التعديل ✓' : 'Utilisateur modifié ✓')
      setEditUser(null)
      await fetchUsers()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <PageHeader
          title={isAr ? 'إدارة المستخدمين' : 'Gestion des utilisateurs'}
          subtitle={`${users.length} ${isAr ? 'مستخدم' : 'utilisateur(s)'}`}
          actions={
            <button onClick={fetchUsers} disabled={loading}
              className="p-2 rounded-xl border border-[#E8E5DE] bg-white text-[#6B6860] hover:bg-[#F5F3FF] transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-[#E8E5DE] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-[#F2F0EB]">
              {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : (
            <div className="divide-y divide-[#F2F0EB]">
              {users.map(u => {
                const store   = STORES.find(s => s.id === u.store_id)
                const isSelf  = u.id === self?.id
                return (
                  <div key={u.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#F8F7F4] transition-all">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm bg-[#6366F1]/10 text-[#6366F1]">
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt="" className="w-full h-full rounded-xl object-cover" />
                        : u.display_name.charAt(0).toUpperCase()
                      }
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#1A1A1A]">
                          {u.display_name}
                          {isSelf && (
                            <span className="ml-2 text-xs text-[#B0ADA6]">
                              ({isAr ? 'أنت' : 'vous'})
                            </span>
                          )}
                        </p>
                        <span className={`inline-flex items-center border rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide ${ROLE_STYLES[u.role] ?? ''}`}>
                          {u.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {store && (
                          <span className="text-xs font-medium" style={{ color: store.color }}>
                            {store.name}
                          </span>
                        )}
                        {u.store_locked && (
                          <span className="text-xs text-amber-600">
                            {isAr ? 'مقيد بالمتجر' : 'Verrouillé au magasin'}
                          </span>
                        )}
                        {u.is_active
                          ? <span className="text-xs text-emerald-600 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              {isAr ? 'نشط' : 'Actif'}
                            </span>
                          : <span className="text-xs text-red-500 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              {isAr ? 'معطل' : 'Désactivé'}
                            </span>
                        }
                      </div>
                    </div>

                    {/* Actions */}
                    {self?.role === 'owner' || (self?.role === 'manager' && u.role !== 'owner') ? (
                      <button
                        onClick={() => openEdit(u)}
                        className="p-2 rounded-xl border border-[#E8E5DE] text-[#6B6860] hover:text-[#1A1A1A] hover:bg-[#F2F0EB] transition-all flex-shrink-0"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editUser && (
        <Modal
          open={!!editUser}
          onClose={() => setEditUser(null)}
          title={isAr ? 'تعديل المستخدم' : 'Modifier l\'utilisateur'}
          size="sm"
        >
          <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
            <Field label={isAr ? 'الاسم' : 'Nom affiché'} required>
              <input type="text" className={inputClass}
                value={form.display_name}
                onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
            </Field>

            <Field label={isAr ? 'الدور' : 'Rôle'} required>
              <select className={selectClass} value={form.role}
                onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                disabled={self?.role !== 'owner'}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                {self?.role === 'owner' && <option value="owner">Owner</option>}
              </select>
            </Field>

            <Field label={isAr ? 'المتجر المخصص' : 'Magasin assigné'}>
              <select className={selectClass} value={form.store_id}
                onChange={e => setForm(p => ({ ...p, store_id: e.target.value }))}>
                <option value="">{isAr ? 'بدون تخصيص' : 'Aucun (flottant)'}</option>
                {STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>

            <div className="flex items-center justify-between p-3 bg-[#F8F7F4] rounded-xl">
              <div>
                <p className="text-sm font-medium text-[#1A1A1A]">
                  {isAr ? 'تقييد بالمتجر' : 'Verrouillé au magasin'}
                </p>
                <p className="text-xs text-[#6B6860] mt-0.5">
                  {isAr ? 'لا يمكنه الوصول لمتاجر أخرى' : 'Redirigé directement sans sélection'}
                </p>
              </div>
              <button
                onClick={() => setForm(p => ({ ...p, store_locked: !p.store_locked }))}
                className={`w-10 h-6 rounded-full transition-all ${form.store_locked ? 'bg-[#6366F1]' : 'bg-[#E8E5DE]'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-all mx-1 ${form.store_locked ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 bg-[#F8F7F4] rounded-xl">
              <div>
                <p className="text-sm font-medium text-[#1A1A1A]">
                  {isAr ? 'الحساب نشط' : 'Compte actif'}
                </p>
                <p className="text-xs text-[#6B6860] mt-0.5">
                  {isAr ? 'إلغاء التفعيل يمنع تسجيل الدخول' : 'Désactiver bloque la connexion'}
                </p>
              </div>
              <button
                onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                className={`w-10 h-6 rounded-full transition-all ${form.is_active ? 'bg-emerald-500' : 'bg-[#E8E5DE]'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-all mx-1 ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Btn variant="secondary" onClick={() => setEditUser(null)}>
                {isAr ? 'إلغاء' : 'Annuler'}
              </Btn>
              <Btn variant="primary" onClick={handleSave} loading={submitting}
                style={{ backgroundColor: '#6366F1' } as React.CSSProperties}>
                {isAr ? 'حفظ التغييرات' : 'Enregistrer'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}