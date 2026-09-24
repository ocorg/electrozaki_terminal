import { prisma } from '@/lib/db'
import { json, handleError, requireUser, HttpError, MANAGERS } from '@/lib/api'

// GET /api/documents/[ref] — a single document by its doc_ref (e.g. EZ-2025-000001)
export async function GET(_request: Request, { params }: { params: { ref: string } }) {
  try {
    await requireUser(MANAGERS)
    const data = await prisma.ez_documents.findFirst({ where: { doc_ref: params.ref, store_id: 'EZ-001' } })
    if (!data) throw new HttpError(404, 'Document introuvable')
    return json({ status: 'success', data })
  } catch (err) {
    return handleError(err, 'GET /api/documents/[ref]')
  }
}
