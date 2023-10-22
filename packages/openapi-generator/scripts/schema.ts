import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodType } from 'zod'


export function convertSchema(input: ZodType) {
  return zodToJsonSchema(input, {
    '$refStrategy': 'none',
    errorMessages: true,
    target: 'openApi3'
  })
}
