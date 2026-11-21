import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
// Liveness only; integration readiness is verified separately without exposing secrets.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
