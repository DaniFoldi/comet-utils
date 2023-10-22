import OpenAPIParser from '@readme/openapi-parser'


export async function validate(file: string): Promise<boolean> {
  try {
    await OpenAPIParser.validate(file)
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}
