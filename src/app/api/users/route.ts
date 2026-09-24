import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import type { user_role } from '@prisma/client'
import { prisma } from '@/lib/db'
import { json, handleError, requireUser, requireActiveUser, HttpError, MANAGERS } from '@/lib/api'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'
import { withNotify } from '@/lib/realtime'

// Everything but password_hash / override_pin — also what goes into the activity log
const PUBLIC_FIELDS = {
  id: true, email: true, display_name: true, role: true, store_id: true, store_locked: true,
  is_active: true, avatar_url: true, created_at: true, updated_at: true,
} as const

const ROLES: user_role[] = ['employe', 'gerant', 'proprietaire']

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    // Staff get names only (e.g. the technician list in Réparations)
    if (new URL(request.url).searchParams.get('mode') === 'names') {
      const data = await prisma.user_profiles.findMany({
        where:   { is_active: true },
        select:  { id: true, display_name: true, is_active: true },
        orderBy: { display_name: 'asc' },
      })
      return json({ data })
    }
    if (!MANAGERS.includes(user.role)) throw new HttpError(403, 'Accès refusé')
    const data = await prisma.user_profiles.findMany({ select: PUBLIC_FIELDS, orderBy: { created_at: 'asc' } })
    return json({ data })
  } catch (err) {
    return handleError(err, 'GET /api/users')
  }
}

async function POST_(request: NextRequest) {
  try {
    const self = await requireActiveUser(MANAGERS)
    const { email, password, full_name, role, store_id, store_locked, is_active } = await request.json() as {
      email: string; password: string; full_name: string; role: user_role
      store_id: string | null; store_locked: boolean; is_active: boolean
    }

    if (!email || !password || !full_name || !role) throw new HttpError(400, 'email, password, full_name et role sont requis')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Format email invalide')
    if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum')
    if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle invalide')
    if (self.role === 'gerant' && role === 'proprietaire') {
      throw new HttpError(403, 'Accès refusé : un gérant ne peut pas créer un compte propriétaire')
    }
    if (full_name.length > 100) throw new HttpError(400, 'Nom trop long (max 100)')
    if (email.length > 200) throw new HttpError(400, 'Email trop long (max 200)')

    const normalized = email.trim().toLowerCase()
    if (await prisma.user_profiles.findUnique({ where: { email: normalized }, select: { id: true } })) {
      throw new HttpError(409, 'Un compte existe déjà avec cet email')
    }

    const profile = await prisma.user_profiles.create({
      data: {
        email:         normalized,
        password_hash: await bcrypt.hash(password, 10),
        display_name:  full_name.trim(),
        role,
        store_id:      store_id || null,
        store_locked:  Boolean(store_locked),
        is_active:     is_active !== false,
      },
      select: PUBLIC_FIELDS,
    })

    await logActivity({
      store_id:    store_id ?? null,
      user_id:     self.id,
      user_name:   self.display_name,
      action_type: 'creation_utilisateur',
      module:      'utilisateurs',
      record_id:   profile.id,
      after_state: profile,
      ip_address:  getIpFromRequest(request),
      notes:       `Nouveau compte : ${full_name}`,
    })

    return json({ status: 'success', data: profile }, { status: 201 })
  } catch (err) {
    return handleError(err, 'POST /api/users')
  }
}

async function PATCH_(request: NextRequest) {
  try {
    const self = await requireActiveUser(MANAGERS)
    const body = await request.json()
    const id = body.id as string | undefined
    if (!id) throw new HttpError(400, 'id requis')

    const before = await prisma.user_profiles.findUnique({ where: { id }, select: PUBLIC_FIELDS })
    if (!before) throw new HttpError(404, 'Utilisateur introuvable')

    // A gérant can neither touch an owner account nor hand out the owner role (incl. to themselves)
    if (self.role === 'gerant' && (before.role === 'proprietaire' || body.role === 'proprietaire')) {
      throw new HttpError(403, 'Accès refusé')
    }
    if (body.role !== undefined && !ROLES.includes(body.role)) throw new HttpError(400, 'Rôle invalide')

    const data = await prisma.user_profiles.update({
      where:  { id },
      data: {
        ...(body.display_name !== undefined && { display_name: String(body.display_name).trim() }),
        ...(body.role         !== undefined && { role: body.role as user_role }),
        ...(body.store_id     !== undefined && { store_id: body.store_id || null }),
        ...(body.store_locked !== undefined && { store_locked: Boolean(body.store_locked) }),
        ...(body.is_active    !== undefined && { is_active: Boolean(body.is_active) }),
        ...(body.avatar_url   !== undefined && { avatar_url: body.avatar_url || null }),
      },
      select: PUBLIC_FIELDS,
    })

    await logActivity({
      user_id:      self.id,
      user_name:    self.display_name,
      action_type:  'modification',
      module:       'utilisateurs',
      record_id:    id,
      before_state: before,
      after_state:  data,
      ip_address:   getIpFromRequest(request),
    })

    return json({ data })
  } catch (err) {
    return handleError(err, 'PATCH /api/users')
  }
}

export const POST = withNotify(POST_)
export const PATCH = withNotify(PATCH_)
