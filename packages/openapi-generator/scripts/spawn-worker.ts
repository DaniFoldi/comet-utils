import getPort, { portNumbers } from 'get-port'
import { unstable_startWorker, unstable_readConfig, experimental_readRawConfig } from 'wrangler'

export async function spawnWorker(file: string, dir: string, depth = 0): Promise<ReturnType<typeof unstable_startWorker>> {
  if (depth >= 5) {
    throw new Error('Failed to spawn worker.')
  }

  // eslint-disable-next-line promise/avoid-new, no-async-promise-executor
  return new Promise(async resolve => {
    try {
      const config = unstable_readConfig({ config: dir })

      const r = Math.floor(Math.random() * 1000)

      const worker = await unstable_startWorker({
        name: config.name,
        entrypoint: file,
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        dev: {
          inspector: {
            port: await getPort({ port: portNumbers(61000 + r, 62000 + r) })
          },
          server: {
            port: await getPort({ port: portNumbers(63000 + r, 64000 + r) })
          },
          logLevel: 'warn'
        }
      })
      await worker.ready

      resolve(worker)
    } catch (error) {
      console.log(error)
      resolve(await spawnWorker(file, dir, depth + 1))
    }
  })
}
