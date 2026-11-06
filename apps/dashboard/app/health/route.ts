export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(
    {
      status: 'ok',
      app: 'nekolog/dashboard',
      version: process.env.DASHBOARD_VERSION ?? 'dev',
      time: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
