import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
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
    external: [ 'node:*', 'cloudflare:' ],
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
    console.log(tmpFilename)
    const script = await readFile(join(process.cwd(), tmpFilename), { encoding: 'utf8' })

    const wrapFetch = (await readFile(join(dirname(import.meta.url), 'wrapFetch.js'), { encoding: 'utf8' }))
      .replace(/export {.*?}/, '')

    const wrappedScript = `${wrapFetch}\n${script.replace(/(\w+) as default/, 'globalThis.wrapFetch($1) as default')}`
    console.log(wrappedScript.slice(-1000))
    const worker = await unstable_dev(wrappedScript)

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
