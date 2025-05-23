import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { defu } from 'defu'
import { build } from 'esbuild'
import { attachComments, collectMiddlewares } from './comments'
import { randomName } from './random'
import temporaryDirectory from 'temp-dir'
import type { mainCommand } from './index'
import type { Paths } from './types'
import type { CommandDef, ParsedArgs } from 'citty'
import type { ServerOptions } from '@neoaren/comet'
import builtinModules from 'builtin-modules'
import getPort, { portNumbers } from 'get-port'
import { unstable_startWorker, unstable_readConfig } from 'wrangler'
import { findUp } from 'find-up'


type Args<Type> = Type extends CommandDef<infer X> ? X : never

async function textReplacements(text: string, entries: string[] = [ 'worker' ]): Promise<string> {
  // replace /** with /*! to prevent removal of comments
  text = text.replaceAll('/**', '/*!')

  for (const entry of entries) {
    // make the *server* variable global, so it can be used in the generated code
    // eslint-disable-next-line unicorn/better-regex
    if (/import ?\{.*?\bserver\b.*?\} ?from ["']@neoaren\/comet["']/s.test(text) && !/durableObject["']?\s*:\s*true/.test(text)) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const serverVariable = text.match(new RegExp(`(const|let|var) (${entry}\\d*) ?= ?server\\(`, 'si'))?.[2]
      if (typeof serverVariable === 'string') {
        console.log('openapi generator found server', entry, serverVariable)
        text = `${text}
globalThis['${entry}'] = ${serverVariable}`
      }
    }
  }

  return text
    .replaceAll(/^import\s*{.*?Pool.*?}\s*from\s*["']pg["']/gm, 'const Pool = class Pool {}')
    .replaceAll(/^import\s*{.*?PrismaPg.*?}\s*from\s*["']@prisma\/adapter-pg["']/gm, 'const PrismaPg = class PrismaPg {}')
}

export async function generate(args: ParsedArgs<Args<typeof mainCommand>>, data: object) {
  const dir = temporaryDirectory ?? process.cwd()
  const tmpFilename = `${dir}/tmp-${randomName()}.js`
  const entrypoints = args.entry.split(',')
  await build({
    entryPoints: [ args.input ],
    bundle: true,
    external: [ 'node:*', 'cloudflare:*', ...builtinModules ],
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

  let worker

  try {
    const script = (await readFile(tmpFilename, { encoding: 'utf8' }))
      .replace(/\b(\w+) as default(?!\.)(.*?)}/s, 'wrappedDefault as default, $2}; var wrappedDefault = globalThis.wrapFetch($1)')
      .replaceAll(/import\s*{\s*EmailMessage\s*}\s*from\s*["']cloudflare:email["']/g, 'const EmailMessage = class EmailMessage {}')

    const wrapFetch = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'wrapFetch.js'), { encoding: 'utf8' }))
      .replace(/export ?{.*?}/s, '')
      .replace('function wrapFetch', 'globalThis.wrapFetch = function wrapFetch')

    const wrappedScript = `(function (globalThis) {${wrapFetch}})(globalThis);\n${script}`

    await writeFile(tmpFilename, wrappedScript)

    const configFile = await findUp([ 'wrangler.json', 'wrangler.jsonc', 'wrangler.toml' ])

    const config = unstable_readConfig({ config: configFile ?? dir })

    const r = Math.floor(Math.random() * 1000)

    worker = await unstable_startWorker({
      name: config.name,
      entrypoint: tmpFilename,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      dev: {
        inspector: {
          port: await getPort({ port: portNumbers(61000 + r, 62000 + r) })
        },
        server: {
          port: await getPort({ port: portNumbers(63000 + r, 64000 + r) })
        },
        logLevel: 'debug',
        remote: false,
        registry: null
      },
      sendMetrics: false,
      build: {
        nodejsCompatMode: 'v2'
      }
    })
    console.log('Creating worker')
    await worker.ready
    console.log('Worker ready')

    const combinedData: Record<string, Paths> = {}
    const combinedOptions: Record<string, ServerOptions<never, never, never>> = {}

    for (const entry of args.entry.split(',')) {
      console.log(`Generating OpenAPI paths for ${entry}`)

      const response = await worker.fetch(`http://internal/__generate_openapi__?date=${args.date}&entry=${entry}`)
      if (response.headers.get('content-type') !== 'application/json') {
        console.debug(await response.text())

        throw new Error('An unexpected error has occurred.')
      }

      const paths = await response.json() as Paths

      const code = await readFile(tmpFilename, { encoding: 'utf8' })
      const middlewares = collectMiddlewares(code)

      console.log('Middlewares found:', middlewares)

      const optionsResponse = await worker.fetch(`http://internal/__options__?entry=${entry}`)
      if (optionsResponse.headers.get('content-type') !== 'application/json') {
        console.debug(await optionsResponse.text())

        throw new Error('An unexpected error has occurred.')
      }

      const options = await optionsResponse.json() as ServerOptions<never, never, never>
      combinedOptions[entry] = options

      console.log('Worker options', options)

      attachComments(script, paths, args.access, args.date, middlewares, options.prefix)

      const mappedPaths = Object.fromEntries(Object.entries(paths).map(([ path, value ]) => {
        return [ path.replaceAll(/(?<=\/):([^/]*)/gm, (_, group) => `{${group}}`), value ]
      }))

      combinedData[entry] = mappedPaths
    }

    await worker.dispose()

    const prefixedMappedPaths = Object.fromEntries(Object
      .entries(combinedData)
      .flatMap(([ _entry, entryPaths ]) => {
        return Object.entries(entryPaths).map(([ path, value ]) => {
          return [ path.replaceAll(/(?<=\/):([^/]*)/gm, (_, group) => `{${group}}`), value ]
        })
      }))

    const output = defu({ openapi: '3.1.0' }, data, { paths: prefixedMappedPaths })
    await mkdir(dirname(args.output), { recursive: true })
    await writeFile(args.output, JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(error)
  } finally {
    try {
      worker?.dispose()
    } catch (error) {
      console.error(error)
    }

    await unlink(tmpFilename)
  }
}
