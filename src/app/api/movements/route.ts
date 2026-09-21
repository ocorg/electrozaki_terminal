import { createClient, createUntypedClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getIpFromRequest } from '@/lib/utils/logger'

interface SourceAccessory {
  acc_id:                 string
  quantite:               number
  nom:                    string
  categorie:              string
  marque:                 string | null
  compatible_with:        string | null
  barcode:                string | null
  prix_achat:             number | null
  prix_vente_recommande:  number | null
  prix_vente_minimum:     number | null
  seuil_alerte:           number
  store_id:               string | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createUntypedClient()
    const { searchParams } = new URL(request.url)
    const store_id   = searchParams.get('store_id')
    const device_type = searchParams.get('device_type')
    const limit      = searchParams.get('limit') || '50'

    let query = supabase
      .from('stock_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (store_id)    query = query.eq('store_id', store_id)
    if (device_type) query = query.eq('device_type', device_type)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ data })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase      = await createUntypedClient()
    const typedSupabase = await createClient()
    const { data: { user } } = await typedSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, store_id, role')
      .eq('id', user.id)
      .single() as { data: { display_name: string; store_id: string | null; role: string } | null }

    // Only manager/owner can move stock
    if (!['manager', 'owner'].includes(profile?.role ?? '')) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await request.json()
    if (!body.device_id || !body.device_type || !body.from_location || !body.to_location) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
    }

    if (body.from_location === body.to_location) {
      return NextResponse.json({ error: 'Source et destination identiques' }, { status: 400 })
    }

    // Accessories are the only device_type that can move a PARTIAL quantity (phones/laptops
    // are unique serialized items — always the whole thing, qty 1). Validate up front so we
    // never log a movement record for a transfer that can't actually be applied.
    let srcAcc: SourceAccessory | null = null
    let movedQty = 1
    if (body.device_type === 'إكسسوار') {
      const { data: acc } = await supabase
        .from('accessories')
        .select('acc_id, quantite, nom, categorie, marque, compatible_with, barcode, prix_achat, prix_vente_recommande, prix_vente_minimum, seuil_alerte, store_id')
        .eq('acc_id', body.device_id)
        .single() as { data: SourceAccessory | null }
      if (!acc) return NextResponse.json({ error: 'Accessoire introuvable' }, { status: 404 })
      srcAcc = acc
      movedQty = Math.max(1, Math.floor(Number(body.quantity) || 1))
      if (movedQty > (acc.quantite ?? 0)) {
        return NextResponse.json(
          { error: `Quantité insuffisante — disponible : ${acc.quantite ?? 0}` },
          { status: 400 }
        )
      }
    }

    // Create movement record
    const { data, error } = await supabase
      .from('stock_movements')
      .insert({
        device_type:   body.device_type,
        device_id:     body.device_id,
        quantity:      movedQty,
        from_location: body.from_location,
        to_location:   body.to_location,
        external_name: body.external_name ?? null,
        reason:        body.reason ?? 'Transfert',
        store_id:      body.store_id ?? profile?.store_id ?? null,
        notes:         body.notes ?? null,
        moved_by:      user.id,
        moved_at:      new Date().toISOString(),
        created_by:    user.id,
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: unknown }

    if (error) throw error
    if (!data) throw new Error('No data returned')

    // Update device location
    const deviceTable = body.device_type === 'هاتف' ? 'phones'
      : body.device_type === 'لابتوب' ? 'laptops'
      : null // accessories are handled separately below (quantity-aware split/merge)

    const deviceIdCol = body.device_type === 'هاتف' ? 'phone_id' : 'laptop_id'

    const toLocation  = body.to_location  as string
    const toStoreId   = (body.to_store_id as string | null) ?? null

    if (deviceTable) {
      const reason = (body.reason as string) ?? 'Transfert'

      const deviceUpdate: Record<string, unknown> = {
        location:   toLocation,
        updated_by: user.id,
      }

      // Statut — uniquement pour les téléphones (ENUM device_status)
      if (body.device_type === 'هاتف') {
        if      (reason === 'Retour')              deviceUpdate.status = 'متوفر'
        else if (reason === 'Réparation Externe')  deviceUpdate.status = 'إصلاح'
        else if (reason === 'Prêt' || toLocation === 'Externe' || toStoreId !== null)
                                                   deviceUpdate.status = 'en_transfert'
        else                                       deviceUpdate.status = 'متوفر'
      }

      // Inter-magasin → transférer la propriété au magasin destination
      if (toStoreId) {
        deviceUpdate.store_id = toStoreId
      }

      await supabase
        .from(deviceTable)
        .update(deviceUpdate)
        .eq(deviceIdCol, body.device_id)
    } else if (srcAcc) {
      const destStoreId = toStoreId ?? srcAcc.store_id
      const isFullMove   = movedQty >= srcAcc.quantite

      if (isFullMove) {
        // Moving everything — relocate the existing row in place, same as before.
        await supabase
          .from('accessories')
          .update({ location: toLocation, store_id: destStoreId, updated_by: user.id })
          .eq('acc_id', srcAcc.acc_id)
      } else {
        // Partial move: decrement the source, then merge into a matching row already at
        // the destination (same SKU there) or create one — never silently relocate the
        // whole record, or the source location would lose stock it's still holding.
        await supabase
          .from('accessories')
          .update({ quantite: srcAcc.quantite - movedQty, updated_by: user.id })
          .eq('acc_id', srcAcc.acc_id)

        let destQuery = supabase
          .from('accessories')
          .select('acc_id, quantite')
          .eq('location', toLocation)
          .eq('is_deleted', false)
          .eq('nom', srcAcc.nom)
          .eq('categorie', srcAcc.categorie)
          .neq('acc_id', srcAcc.acc_id)
        destQuery = destStoreId ? destQuery.eq('store_id', destStoreId) : destQuery.is('store_id', null)
        destQuery = srcAcc.marque ? destQuery.eq('marque', srcAcc.marque) : destQuery.is('marque', null)

        const { data: destMatch } = await destQuery.maybeSingle() as
          { data: { acc_id: string; quantite: number } | null }

        if (destMatch) {
          await supabase
            .from('accessories')
            .update({ quantite: destMatch.quantite + movedQty, updated_by: user.id })
            .eq('acc_id', destMatch.acc_id)
        } else {
          await supabase
            .from('accessories')
            .insert({
              nom:                   srcAcc.nom,
              categorie:             srcAcc.categorie,
              marque:                srcAcc.marque,
              compatible_with:       srcAcc.compatible_with,
              barcode:               srcAcc.barcode,
              prix_achat:            srcAcc.prix_achat,
              prix_vente_recommande: srcAcc.prix_vente_recommande,
              prix_vente_minimum:    srcAcc.prix_vente_minimum,
              seuil_alerte:          srcAcc.seuil_alerte,
              quantite:              movedQty,
              location:              toLocation,
              store_id:              destStoreId,
              is_deleted:            false,
              created_by:            user.id,
              updated_by:            user.id,
            })
        }
      }
    }

    await logActivity({
      store_id:    data.store_id as string ?? null,
      user_id:     user.id,
      user_name:   profile?.display_name ?? '—',
      action_type: 'UPDATE',
      module:      'stock_movements',
      record_id:   data.movement_id as string,
      after_state: data,
      ip_address:  getIpFromRequest(request),
      notes:       `${body.device_id} : ${body.from_location} → ${body.to_location}`,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}