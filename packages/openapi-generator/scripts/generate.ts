import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defu } from 'defu'
import { build } from 'esbuild'
import { unstable_dev } from 'wrangler'
import { attachComments } from './comments'
import { randomName } from './random'
import { validate } from './validate'
import type { mainCommand } from './index'
import type { Paths } from './types'
import type { CommandDef, ParsedArgs } from 'citty'


type Args<Type> = Type extends CommandDef<infer X> ? X : never

export async function generate(args: ParsedArgs<Args<typeof mainCommand>>, data: object) {
  const tmpFilename = `./tmp-${randomName()}.js`
  await build({
    entryPoints: [ args.input ],
    bundle: true,
    external: [ 'node:*', 'cloudflare:*' ],
    legalComments: 'inline',
    outfile: tmpFilename,
    format: 'esm',
    plugins: [
      {
        name: 'replace-jsdoc-with-legal',
        setup(build) {
          build.onLoad({ filter: /.ts$/ }, async args => {
            const text = await readFile(args.path, 'utf8')
            return {
              contents: text.replaceAll('/**', '/*!'),
              loader: 'ts'
            }
          })
          build.onLoad({ filter: /.js$/ }, async args => {
            const text = await readFile(args.path, 'utf8')
            return {
              contents: text.replaceAll('/**', '/*!'),
              loader: 'js'
            }
          })
        }
      }
    ]
  })

  try {
    const script = await readFile(join(process.cwd(), tmpFilename), { encoding: 'utf8' })

    const wrapFetch = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'wrapFetch.js'), { encoding: 'utf8' }))
      .replace(/export ?{.*?}/s, '')
      .replace('function wrapFetch', 'globalThis.wrapFetch = function wrapFetch')

    const wrappedScript = `(function (globalThis) {${wrapFetch}})(globalThis);\n${script.replace(/\b(\w+) as default(.*?)}/s, 'wrappedDefault as default, $2}; var wrappedDefault = globalThis.wrapFetch($1)')}`

    await writeFile(tmpFilename, wrappedScript)

    const worker = await unstable_dev(tmpFilename, {
      experimental: {
        disableExperimentalWarning: true
      }
    })

    const response = await worker.fetch(`/__generate_openapi__?date=${args.date}`)
    const paths = await response.json() as Paths

    await worker.stop()

    const code = await readFile(tmpFilename, { encoding: 'utf8' })
    attachComments(code, paths)

    const output = defu({ openapi: '3.1.0' }, data, { paths })
    await writeFile(args.output, JSON.stringify(output, null, 2))

    if (await validate(args.output)) {
      console.log('Generated OpenAPI file looks valid')
    }
  } catch (error) {
    console.error(error)
  } finally {
    // await unlink(tmpFilename)
  }
}
