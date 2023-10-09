import { readFile } from 'node:fs/promises'
import { defineCommand, runMain } from 'citty'
import { z } from 'zod'
import { generate } from './generate'
import { fileExists } from './utils'


export const mainCommand = defineCommand({
  meta: {
    name: 'generate',
    version: '1.0.0',
    description: 'Generate OpenAPI docs for comet routes'
  },
  args: {
    input: {
      type: 'string',
      default: 'src/index.ts'
    },
    output: {
      type: 'string',
      default: 'openapi.json'
    },
    date: {
      type: 'string',
      default: 'today'
    },
    base: {
      type: 'string',
      default: 'openapi-base.json'
    }
  },
  async run({ args }) {
    if (!await fileExists(args.input)) {
      console.error(`Input file '${args.input}' does not exist!`)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }

    if (!await fileExists(args.base)) {
      console.error(`Base file '${args.base}' does not exist!`)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }

    let data
    try {
      data = JSON.parse(await readFile(args.base, 'utf8'))
    } catch (error) {
      console.error(`Base file '${args.base}' is not valid JSON!`)
      console.error(error)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }

    try {
      data = z.object({
        info: z.object({
          title: z.string().min(1),
          version: z.string().min(1)
        })
      }).parse(data)
    } catch (error) {
      console.error(`Base file '${args.base}' must be a JSON object with non-empty info.title and info.version!`)
      console.error(error)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) && args.date !== 'today') {
      console.error('Invalid date argument! "YYYY-MM-DD" format or \'today\' required.')
      return
    }

    await generate(args, data)
  }
})

await runMain(mainCommand)
