import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { toAnalysisResult } from '@/lib/agent-analysis'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const analysisId = parseInt(id, 10)

  if (Number.isNaN(analysisId)) {
    return NextResponse.json({ error: 'Invalid analysis id' }, { status: 400 })
  }

  const row = await prisma.agentAnalysis.findUnique({
    where: { id: analysisId },
  })

  if (!row || row.status !== 'completed') {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: row.id,
    cached: true,
    result: toAnalysisResult(row),
  })
}
