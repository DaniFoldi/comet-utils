import getPort from 'get-port'
import { unstable_startWorker } from 'wrangler'

export async function spawnWorker(file: string, depth = 0): Promise<ReturnType<typeof unstable_startWorker>> {
  if (depth >= 5) {
    throw new Error('Failed to spawn worker.')
  }

  // eslint-disable-next-line promise/avoid-new, no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      console.log('try')

      const worker = await unstable_startWorker({
        entrypoint: file,
        compatibilityDate: '2024-12-01',
        compatibilityFlags: [ 'nodejs_compat' ],
        dev: {
          inspector: {
            port: await getPort({ port: 9229 })
          },
          server: {
            port: await getPort({ port: 8787 })
          }
        }
      })
      console.log('spawn')
      await worker.ready
      console.log('ready')

      resolve(worker)
    } catch (error) {
      console.log(error)
      resolve(await spawnWorker(file, depth + 1))
    }
  })
}
