import { MaybePromise } from './types'
import { Data } from './data'
import { Reply, ReplyFrom, Status } from './reply'
import type { ZodType } from 'zod'


export interface Middleware<T> {
  name?: string
  requires?: MiddlewareList
  handler: (event: any) => MaybePromise<void>
  replies?: Partial<Record<Status, ZodType>>
}

export type MiddlewareList = readonly [...readonly Middleware<any>[]]

export type ExtensionFrom<MW> = MW extends Middleware<infer Extension> ? Extension : never
export type ExtensionsFrom<MWs, Accumulator = unknown> = MWs extends readonly [infer Current, ...infer Rest]
  ? ExtensionsFrom<Rest, Accumulator & ExtensionFrom<Current>>
  : Accumulator

type MiddlewareContext = { env: Environment; request: Request } & (
  { isDurableObject: true; state: DurableObjectState }
  |
  { isDurableObject: false; ctx: ExecutionContext }
  )

class NextData<const T extends Record<string, unknown> = Record<never, never>> {
  // @ts-ignore
  constructor(public data: T = {}) {}
}

type NextFn = <const T extends Record<string, unknown> = Record<never, never>>(data?: T) => NextData<T>

const next: NextFn = (extension?: any) => new NextData(extension)

export function middleware<
  const Extension extends Record<string, unknown> = Record<never, never>
>(
  handler: (event: Data & { reply: Reply; next: NextFn } & MiddlewareContext) => MaybePromise<NextData<Extension> | Reply>
): Middleware<Extension extends Record<any, any> ? Extension : unknown>

export function middleware<
  const Requires extends MiddlewareList,
  const Replies extends Partial<Record<Status, ZodType>> | undefined = undefined,
  const Extension extends Record<string, unknown> = Record<never, never>
>(
  options: {
    name?: string
    requires?: Requires
    replies?: Replies
  },
  handler: (event: Data & { reply: ReplyFrom<Replies>; next: NextFn } & MiddlewareContext & ExtensionsFrom<Requires>) => MaybePromise<NextData<Extension> | Reply>
): Middleware<Extension extends Record<any, any> ? Extension : unknown>

export function middleware<
  const Requires extends MiddlewareList,
  const Replies extends Partial<Record<Status, ZodType>> | undefined = undefined,
  const Extension extends Record<string, unknown> = Record<never, never>
>(
  options: {
    name?: string
    requires?: Requires
    replies?: Replies
  } | ((event: Data & { reply: Reply; next: NextFn } & MiddlewareContext) => MaybePromise<NextData<Extension> | Reply>),
  handler?: (event: Data & { reply: ReplyFrom<Replies>; next: NextFn } & MiddlewareContext & ExtensionsFrom<Requires>) => MaybePromise<NextData<Extension> | Reply>
): Middleware<Extension extends Record<any, any> ? Extension : unknown> {
  const _options = typeof options === 'object' ? options : {}
  const _handler = typeof options === 'function' ? options : handler
  if (!_handler) throw new Error('[Comet] A middleware received no handler argument.')
  return {
    ..._options,
    handler: async event => {
      const nextData = await _handler(Object.assign(event, { next }))
      if (nextData instanceof NextData) Object.assign(event, nextData.data)
    }
  }
}
