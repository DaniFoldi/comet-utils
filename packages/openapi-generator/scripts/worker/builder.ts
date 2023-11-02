import { Server } from '@neoaren/comet'
import { buildPaths } from './paths'


type FetchHandler = (request: Request) => Promise<Response> | Response

export function wrapFetch(originalFetch: FetchHandler): { fetch: FetchHandler } {
  return {
    fetch: async (request: Request) => {
      const { pathname, searchParams } = new URL(request.url)
      if (pathname === '/__generate_openapi__' && searchParams.has('date')) {
        // @ts-expect-error haha
        const server: Server<never, never, never> = globalThis.worker
        const router = Server.getRouter(server)
        const routes = router.getRoutes()

        const paths = buildPaths(routes, searchParams.get('date') ?? '')
        return Response.json(paths)
      }
      return originalFetch(request)
    }
  }
}
