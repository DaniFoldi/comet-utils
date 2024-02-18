import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodType } from 'zod'


export function convertSchema(input: ZodType) {
  const { $schema, definitions, ...schema } = zodToJsonSchema(input, {
    '$refStrategy': 'none',
    errorMessages: true,
    target: 'openApi3'
  })

  return schema
}
