import { Status, type Route } from '@neoaren/comet'
import { convertSchema } from './schema'
import type { Operation, Parameter } from '../types'
import { type ZodAny, type ZodOptional, type SomeZodObject, type ZodType, type ZodTypeAny, z } from 'zod'


function objectSchemaToParameters(schema: ZodType | undefined, where: Parameter['in']): Array<Parameter> | undefined {
  if (!schema) return undefined

  try {
    const objectSchema = schema as SomeZodObject

    return where === 'path'
      ? Object.keys(objectSchema.keyof().enum)
        .map(name => ({
          name,
          in: where,
          required: true,
          schema: convertSchema(objectSchema.shape[name] as ZodType)
        }))
      : Object.keys(objectSchema.keyof().enum)
        .map(name => ({
          name,
          in: where,
          required: !objectSchema.shape[name]?.isOptional(),
          schema: convertSchema(objectSchema.shape[name]?.isOptional()
            ? (objectSchema.shape[name] as ZodOptional<ZodAny>).unwrap()
            : objectSchema.shape[name] as ZodTypeAny)
        }))
  } catch {
    return undefined
  }
}

const replies: Record<Status, number> = {
  [Status.Continue]: 100,
  [Status.SwitchingProtocols]: 101,
  [Status.Processing]: 102,
  [Status.Ok]: 200,
  [Status.Created]: 201,
  [Status.Accepted]: 202,
  [Status.NonAuthoritativeInformation]: 203,
  [Status.NoContent]: 204,
  [Status.ResetContent]: 205,
  [Status.PartialContent]: 206,
  [Status.MultiStatus]: 207,
  [Status.MultipleChoices]: 300,
  [Status.MovedPermanently]: 301,
  [Status.MovedTemporarily]: 302,
  [Status.SeeOther]: 303,
  [Status.NotModified]: 304,
  [Status.UseProxy]: 305,
  [Status.TemporaryRedirect]: 307,
  [Status.PermanentRedirect]: 308,
  [Status.BadRequest]: 400,
  [Status.Unauthorized]: 401,
  [Status.PaymentRequired]: 402,
  [Status.Forbidden]: 403,
  [Status.NotFound]: 404,
  [Status.MethodNotAllowed]: 405,
  [Status.NotAcceptable]: 406,
  [Status.ProxyAuthenticationRequired]: 407,
  [Status.RequestTimeout]: 408,
  [Status.Conflict]: 409,
  [Status.Gone]: 410,
  [Status.LengthRequired]: 411,
  [Status.PreconditionFailed]: 412,
  [Status.RequestTooLong]: 413,
  [Status.RequestUriTooLong]: 414,
  [Status.UnsupportedMediaType]: 415,
  [Status.RequestedRangeNotSatisfiable]: 416,
  [Status.ExpectationFailed]: 417,
  [Status.ImATeapot]: 418,
  [Status.InsufficientSpaceOnResource]: 419,
  [Status.MethodFailure]: 420,
  [Status.MisdirectedRequest]: 421,
  [Status.UnprocessableEntity]: 422,
  [Status.FailedDependency]: 424,
  [Status.UpgradeRequired]: 426,
  [Status.PreconditionRequired]: 428,
  [Status.TooManyRequests]: 429,
  [Status.RequestHeaderFieldsTooLarge]: 431,
  [Status.UnavailableForLegalReasons]: 451,
  [Status.InternalServerError]: 500,
  [Status.NotImplemented]: 501,
  [Status.BadGateway]: 502,
  [Status.ServiceUnavailable]: 503,
  [Status.GatewayTimeout]: 504,
  [Status.HttpVersionNotSupported]: 505,
  [Status.InsufficientStorage]: 507,
  [Status.NetworkAuthenticationRequired]: 511
}


export function routeToOpenApiOperation(route: Route): Operation {
  const path = objectSchemaToParameters(route.schemas.params, 'path')
  const query = objectSchemaToParameters(route.schemas.query, 'query')
  const compatibilityDate: Parameter | undefined = route.compatibilityDate ? { name: 'x-compatibility-date', in: 'header', description: '', required: true, schema: convertSchema(z.literal(route.compatibilityDate)) } : undefined

  const parameters = [ ...path ?? [], ...query ?? [], ...compatibilityDate ? [ compatibilityDate ] : [] ]


  const bodySchema = route.schemas.body ? convertSchema(route.schemas.body) : {}
  const requestBody = bodySchema ? {
    content: {
      'application/json': {
        schema: Object.fromEntries(Object.entries(bodySchema)
          .filter(entry => entry[1] !== undefined))
      }
    } as { [key: string]: object },
    required: !route.schemas.body?.isOptional()
  } : undefined
  const responses = route.replies
    ? Object.fromEntries(Object.entries(route.replies).map(reply =>
      [
        replies[reply[0] as Status], {
          content: {
            'application/json': {
              schema:
                convertSchema(reply[1])
            }
          },
          description: `Response for status ${reply[0]}`
        }
      ]))
    : undefined

  return {
    ...parameters ? { parameters } : {},
    ...requestBody ? { requestBody } : {},
    ...responses ? { responses } : {}
  }
}
