import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defu } from 'defu'
import { build } from 'esbuild'
import { unstable_startWorker } from 'wrangler'
import { attachComments, collectMiddlewares } from './comments'
import { randomName } from './random'
import temporaryDirectory from 'temp-dir'
import type { mainCommand } from './index'
import type { Paths } from './types'
import type { CommandDef, ParsedArgs } from 'citty'


type Args<Type> = Type extends CommandDef<infer X> ? X : never

async function textReplacements(text: string, entries: string[] = ['worker']): Promise<string> {
  // replace /** with /*! to prevent removal of comments
  text = text.replaceAll('/**', '/*!')

  for (const entry of entries) {
    // make the *server* variable global, so it can be used in the generated code
    if (/import ?{.*?\bserver\b.*?} ?from ["']@neoaren\/comet["']/s.test(text) && !/durableObject["']?\s*:\s*true/.test(text)) {
      const serverVariable = text.match(/(const|let) (\S+) ?= ?server\(/s)?.[2]
      text = `${text}\nglobalThis[${entry}] = ${serverVariable}`
    }
  }

  return text
}

export async function generate(args: ParsedArgs<Args<typeof mainCommand>>, data: object) {
  const dir = temporaryDirectory ?? process.cwd()
  const tmpFilename = `${dir}/tmp-${randomName()}.js`
  const entrypoints = args.entry.split(',')
  await build({
    entryPoints: [ args.input ],
    bundle: true,
    external: [ 'node:*', 'cloudflare:*' ],
    conditions: [ 'workerd', 'worker', 'browser' ],
    legalComments: 'inline',
    outfile: tmpFilename,
    format: 'esm',
    plugins: [
      {
        name: 'text-replacements',
        setup(build) {
          build.onLoad({ filter: /.ts$/ }, async args => {
            const text = await readFile(args.path, 'utf8')

            return {
              contents: await textReplacements(text, entrypoints),
              loader: 'ts'
            }
          })
          build.onLoad({ filter: /.js$/ }, async args => {
            const text = await readFile(args.path, 'utf8')

            return {
              contents: await textReplacements(text),
              loader: 'js'
            }
          })
        }
      },
      {
        name: 'wasm-binary',
        setup: build => {
          build.onLoad({ filter: /.wasm$/ }, async args => ({
            contents: await readFile(args.path),
            loader: 'binary'
          }))
        }
      }
    ]
  })

  try {
    const script = (await readFile(tmpFilename, { encoding: 'utf8' }))
      .replace(/\b(\w+) as default(?!\.)(.*?)}/s, 'wrappedDefault as default, $2}; var wrappedDefault = globalThis.wrapFetch($1)')
      .replaceAll(/import\s*{\s*EmailMessage\s*}\s*from\s*["']cloudflare:email["']/g, 'const EmailMessage = class EmailMessage {}')

    const wrapFetch = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'wrapFetch.js'), { encoding: 'utf8' }))
      .replace(/export ?{.*?}/s, '')
      .replace('function wrapFetch', 'globalThis.wrapFetch = function wrapFetch')

    const wrappedScript = `(function (globalThis) {${wrapFetch}})(globalThis);\n${script}`

    await writeFile(tmpFilename, wrappedScript)

    const worker = await unstable_startWorker({
      entrypoint: tmpFilename,
      compatibilityDate: '2024-08-01',
      compatibilityFlags: [ 'nodejs_compat' ]
    })

    await worker.ready

    const response = await worker.fetch(`http://internal/__generate_openapi__?date=${args.date}`)
    if (response.headers.get('content-type') !== 'application/json') {
      console.debug(await response.text())

      throw new Error('An unexpected error has occurred.')
    }

    const paths = await response.json() as Paths

    await worker.dispose()

    const code = await readFile(tmpFilename, { encoding: 'utf8' })
    const middlewares = collectMiddlewares(code)
    attachComments(script, paths, args.access, args.date, middlewares)

    const mappedPaths = Object.fromEntries(Object.entries(paths).map(([ path, value ]) => {
      return [ path.replaceAll(/(?<=\/):([^/]*)/gm, (_, group) => `{${group}}`), value ]
    }))

    const output = defu({ openapi: '3.1.0' }, data, { paths: mappedPaths })
    await mkdir(dirname(args.output), { recursive: true })
    await writeFile(args.output, JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(error)
  } finally {
    await unlink(tmpFilename)
  }
}
