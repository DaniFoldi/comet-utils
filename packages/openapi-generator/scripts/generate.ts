import { readFile, unlink, writeFile } from 'node:fs/promises'
import { Server } from '@neoaren/comet'
import { defu } from 'defu'
import { build } from 'esbuild'
import { attachComments } from './comments'
import { buildPaths } from './paths'
import { randomName } from './random'
import type { mainCommand } from './index'
import type { CommandDef, ParsedArgs } from 'citty'


type Args<Type> = Type extends CommandDef<infer X> ? X : never

export async function generate(args: ParsedArgs<Args<typeof mainCommand>>, data: object) {
  const tmpFilename = `./tmp-${randomName()}.js`
  await build({
    entryPoints: [ args.input ],
    bundle: true,
    // packages: 'external',
    external: [ '@neoaren/comet', 'zod', 'node:*', 'cloudflare:', 'astro:*' ],
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

    /*
      const builtWorker = await readFile(tmpFilename, 'utf8')
      await writeFile(tmpFilename, builtWorker.replace('@neoaren/comet', './dist/index.mjs'), 'utf8')
    */

    // @ts-expect-error URLPattern is not typed
    if (!globalThis.URLPattern) {
      await import('urlpattern-polyfill')
    }

    // resolve and import tmpfile from cwd
    const tmpImport = await import(new URL(tmpFilename, `file://${process.cwd()}/`).href)

    const server: Server<never, never, never> = args.export === ''
      ? tmpImport[Object.keys(tmpImport).find(key => key !== 'default') ?? 'default']
      : tmpImport[args.export]
    const router = Server.getRouter(server)
    const routes = router.getRoutes()

    const paths = buildPaths(routes, args.date)

    const code = await readFile(tmpFilename, { encoding: 'utf8' })
    attachComments(code, paths)

    const output = defu({ openapi: '3.1.0' }, data, { paths })
    await writeFile(args.output, JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(error)
  } finally {
    await unlink(tmpFilename)
  }
}
