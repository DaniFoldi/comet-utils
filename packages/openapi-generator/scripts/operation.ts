import {zodToJsonSchema} from "zod-to-json-schema";

export function routeToOpenApiOperation(route: Route): Operation {
  const path = objectSchemaToParameters(route.schemas.params)
  const query = objectSchemaToParameters(route.schemas.query)

  const pathParams = path ? path
    .map(el => ({ in: 'path' as const, name: el[0], required: true, schema: el[1] })) satisfies Array<{ required: true }> : []
  const queryParams = query ? query
    .map(el => ({ in: 'query' as const, name: el[0], required: !el[2], schema: el[1], compatibilityDate: route.compatibilityDate })) : []
  const parameters = [ ...pathParams, ...queryParams ].length > 0 ? [ ...pathParams, ...queryParams ] : undefined

  const body = route.schemas.body ? { content: zodToJsonSchema(route.schemas.body, { target: 'openApi3' }) } : undefined
  const responses = route.replies
    ? Object.fromEntries(Object.entries(route.replies).map(reply =>
      [ replies[reply[0] as Status], zodToJsonSchema(reply[1], { target: 'openApi3' }) ]))
    : undefined

  return {
    parameters,
    requestBody: body,
    responses
  } as Operation
}
