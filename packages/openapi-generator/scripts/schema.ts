import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodType } from 'zod'


export function convertSchema(input: ZodType, path: string[]) {
  return zodToJsonSchema(input, {
    basePath: path,
    '$refStrategy': 'root',
    errorMessages: true,
    target: 'openApi3'
  })
}
