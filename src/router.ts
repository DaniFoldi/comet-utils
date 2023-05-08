import { ExtensionsFrom, MiddlewareList } from './middleware'
import { MaybePromise, Method } from './types'
import { Reply, ReplyFrom, Status } from './reply'
import { Data } from './data'
import {
  compareCompatibilityDates,
  compareMethods,
  comparePathnames,
  isValidCompatibilityDate,
  isValidPathname
} from './utils'
import { Logger } from './logger'
import type { TypeOf, ZodType } from 'zod'


type RouteContext<IsDo extends boolean> = IsDo extends true
  ? { request: Request; env: Environment; isDurableObject: true; state: DurableObjectState }
  : { request: Request; env: Environment; isDurableObject: false; ctx: ExecutionContext }

type BodyFromSchema<T> = { body: T extends ZodType ? TypeOf<T> : unknown }
type ParamsFromSchema<T> = { params: T extends ZodType ? TypeOf<T> : Partial<Record<string, string>> }
type QueryFromSchema<T> = { query: T extends ZodType ? TypeOf<T> : Partial<Record<string, string>> }
type Stuff<Body, Params, Query> = BodyFromSchema<Body> & ParamsFromSchema<Params> & QueryFromSchema<Query> // TODO rename

export interface Route {
  name: string
  method: Method
  pathname: string
  compatibilityDate?: string
  before?: MiddlewareList
  after?: MiddlewareList
  handler: (event: any) => MaybePromise<Reply>
  replies?: Partial<Record<Status, ZodType>>
  schemas: {
    body?: ZodType
    params?: ZodType
    query?: ZodType
  }
}

export interface RouterOptions {
  prefix?: string
}

export class Router<
  const SBefore extends MiddlewareList,
  const SAfter extends MiddlewareList,
  const IsDo extends boolean = false
> {

  // Registry of routes
  private routes: Route[] = []
  private ready = true

  // Take router options
  constructor(private options: RouterOptions, private logger: Logger) {}

  // Register a new route
  public register = <
    const RBefore extends MiddlewareList,
    const RAfter extends MiddlewareList,
    const Replies extends Partial<Record<Status, ZodType>> | undefined = undefined,
    const Body extends ZodType | undefined = undefined,
    const Params extends ZodType | undefined = undefined,
    const Query extends ZodType | undefined = undefined
  >(
    options: {
      name?: string
      method?: Method | keyof typeof Method
      pathname?: string
      compatibilityDate?: string
      before?: RBefore
      after?: RAfter
      replies?: Replies
      body?: Body
      params?: Params
      query?: Query
    },
    handler: (event: Data & RouteContext<IsDo> & Stuff<Body, Params, Query> & { reply: ReplyFrom<Replies>; logger: Logger } & ExtensionsFrom<SBefore> & ExtensionsFrom<RBefore>) => MaybePromise<Reply>
  ): void => {
    const pathname = `${this.options.prefix ?? ''}${options.pathname ?? '*'}`
    const method = (options.method ?? Method.ALL) as Method
    const compatibilityDate = options.compatibilityDate
    const name = options.name ?? `${method} ${pathname}${compatibilityDate ? ` (${compatibilityDate})` : ''}`
    if (!isValidPathname(pathname)) {
      this.logger.error(`[Comet] Failed to set up route '${name}' due to an invalid pathname.`)
      return
    }
    if (options.compatibilityDate !== undefined && !isValidCompatibilityDate(options.compatibilityDate)) {
      this.logger.error(`[Comet] Failed to set up route '${name}' due to an invalid compatibility date.`)
      return
    }
    const schemas = { body: options.body, params: options.params, query: options.query }
    this.routes.push({ ...options, pathname, method, name, handler, schemas })
    this.ready = false
  }

  // Find a route on a server by pathname, method and compatibility date
  public find = (
    pathname?: string,
    method?: string,
    compatibilityDate?: string,
    ignoreCompatibilityDate?: boolean
  ): Route | undefined => {
    for (const route of this.routes) {
      const doPathnamesMatch = comparePathnames(pathname, route.pathname)
      if (!doPathnamesMatch) continue
      const doMethodsMatch = compareMethods(method, route.method)
      if (!doMethodsMatch) continue
      if (ignoreCompatibilityDate) return route
      const doCompatibilityDatesMatch = compareCompatibilityDates(compatibilityDate, route.compatibilityDate)
      if (doCompatibilityDatesMatch) return route
    }
  }

  // Initialize router by sorting the routes by compatibility date in descending order to ensure the correct functioning of the find algorithm
  public init = (): void => {
    if (this.ready) return
    this.routes.sort((a, b) => {
      if (a.pathname !== b.pathname || a.method !== b.method) return 0
      return compareCompatibilityDates(a.compatibilityDate, b.compatibilityDate) ? -1 : 1
    })
    this.ready = true
  }

}