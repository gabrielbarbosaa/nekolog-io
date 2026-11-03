export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(
    {
      status: 'ok',
      app: 'nekolog/web',
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
      time: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
