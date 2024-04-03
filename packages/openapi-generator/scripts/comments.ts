import { parse } from '@babel/parser'
import babelTraverse, { NodePath } from '@babel/traverse'
import type { Paths } from './types'
import type { CallExpression, ObjectProperty } from '@babel/types'


type JSDocParameters = {
  access: string
  description: string
  summary: string
  tags: string[]
  reply: Record<string, { description: string; headers?: string[] }>
  deprecated?: true
}

type MiddlewareParameters<T = unknown> = {
  requestHeaders: (string | { name: string; schema: object })[]
  responses: Record<string, { name: string } & T>
}

export function attachComments(
  code: string,
  paths: Paths,
  access: string,
  date: string,
  middlewares: { name: string; params: MiddlewareParameters }[]
) {
  const astree = parse(code, { attachComment: true, plugins: [], sourceType: 'module' })
  if (astree.errors.length > 0) {
    console.error(astree.errors)

    return
  }

  for (const [ key, value ] of Object.entries(paths)) {
    if (!value) {
      continue
    }

    for (const [ method, operation ] of Object.entries(value)) {
      if (typeof operation === 'string' || Array.isArray(operation) || 'url' in operation) {
        continue
      }

      if (method === 'connect') {
        console.warn(`Method is not supported by OpenAPI, skipping CONNECT ${key}`)
        continue
      }

      const methodToCompare = method.toUpperCase()

      // @ts-expect-error This babel traverse types are wrong
      babelTraverse.default(astree, {
        enter(path: NodePath) {
          if (!path.node.leadingComments) {
            return
          }

          if (path.node.type === 'ExpressionStatement') {
            if (path.node.expression.type !== 'CallExpression') {
              return
            }

            const params = path.node.expression.arguments[0]
            if (!params || params.type !== 'ObjectExpression') {
              return
            }

            const propertiesArray = params.properties.filter(property => property.type === 'ObjectProperty') as ObjectProperty[]

            const beforeValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'before')?.value
            const beforeNames = code.slice(beforeValue?.start ?? 0, beforeValue?.end ?? 0).match(/\b(\w+)(?=\()/g)
            const methodValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'method')?.value
            const pathnameValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'pathname')?.value
            const commentMethod = code.slice(methodValue?.start ?? 0, methodValue?.end ?? 0).replaceAll('\'"', '').replace(/.*\./, '')

            if (commentMethod !== methodToCompare) {
              return
            }

            if (pathnameValue?.type === 'StringLiteral' && pathnameValue.value !== key) {
              return
            }

            const commonMWs = middlewares.length > 0 && beforeNames !== null
              ? middlewares.filter(element => beforeNames.includes(element.name))
              : []
            const doc = parseComment(path.node.leadingComments.map(comment => comment.value).join('\n'))
            operation.description = doc.description
            operation.summary = doc.summary
            operation.tags = doc.tags
            if (doc.deprecated) {
              operation.deprecated = true
            }

            const replyKey = Object.keys(doc.reply)[0]
            if (replyKey) {
              // TODO headers as headers object
              const description = doc.reply[replyKey]?.description
              if (!(replyKey in operation.responses)) {
                // @ts-expect-error stfu
                operation.responses[replyKey] = {}
              }

              operation.responses[replyKey]!.description = description ?? `${doc.summary} ${replyKey} response`
            }

            commonMWs.map(mw => {
              Object.entries(mw.params.responses).map(([ key, value ]) => {
                if (!(key in operation.responses)) {
                  operation.responses[key] = value
                  if (typeof operation.responses[key]?.description === 'undefined') {
                    operation.responses[key]!.description = `${doc.summary} ${replyKey} response`
                  }
                }
              })

              mw.params.requestHeaders.map(header => {
                if (typeof header === 'string') {
                  operation.parameters?.push({ name: header, in: 'header', required: true })
                } else if (Object.keys(header.schema).length === 0) {
                  operation.parameters?.push({ name: header.name, in: 'header', required: true })
                } else {
                  operation.parameters?.push({ name: header.name, in: 'header', required: true, schema: header.schema })
                }
              })
            })
            // @ts-expect-error This could be typed, but it's fine :tm:
            operation.access = doc.access
          }
        }
      })

      if (!operation.description) {
        operation.description = `${method} ${key}`
      }

      // @ts-expect-error This could be typed, but it's fine :tm:
      if ((access === 'public' && operation.access !== 'public') || (access === 'private' && (operation.access !== 'public' || operation.access !== 'private'))) {
        // @ts-expect-error This could be typed, but it's fine :tm:
        delete paths[key][method]
      }

      for (const [status, response] of Object.entries(operation.responses)) {
        response.description = response.description ?? `${operation.summary} ${status} response`
      }

      // @ts-expect-error This could be typed, but it's fine :tm:
      delete operation.access
    }

    if (Object.keys(paths[key] ?? {}).length === 0) {
      delete paths[key]
    }
  }
}

export function collectMiddlewares(code: string): { name: string; params: MiddlewareParameters }[] {
  const middlewares: { name: string; params: MiddlewareParameters }[] = []
  const astree = parse(code, { attachComment: true, plugins: [], sourceType: 'module' })
  if (astree.errors.length > 0) {
    console.error(astree.errors)

    return middlewares
  }

  const commentsByLine = new Map()

  // @ts-expect-error Babel types are broken
  babelTraverse.default(astree, {
    enter(path: NodePath) {
      if (path.node.leadingComments) {
        const line = path.node.loc?.start.line
        commentsByLine.set(line, path.node.leadingComments.map(comment => comment.value))
      }
    }
  })
  // @ts-expect-error Babel types are broken
  babelTraverse.default(astree, {
    CallExpression(path: NodePath<CallExpression>) {
      if (path.node.callee.type === 'Identifier' && path.node.callee?.name === 'middleware') {
        let middlewareName = ''
        const variableDeclaration = path.findParent(parent => parent.isVariableDeclarator())
        if (!variableDeclaration) {
          return
        }

        middlewareName = variableDeclaration.node.id?.name

        const line = path.node.loc?.start.line
        const comments = commentsByLine.get(line)
        if (!comments) {
          return
        }

        const doc = parseMiddlewareComment(comments.map((comment: string) => comment).join('\n'))
        middlewares.push({ name: middlewareName, params: doc })
      }
    }
  })

  return middlewares
}

function parseComment(comments: string): JSDocParameters {
  const commentArray = comments.split('* @').slice(1).map(comment => {
    return comment.slice(0, -2)
  })

  const commentsByType: JSDocParameters = {
    access: '',
    description: '',
    summary: '',
    tags: [],
    reply: {}
  }

  for (const comment of commentArray) {
    const [ head, ...rest ] = comment.split(' ')

    switch (head) {
      case 'description':
        commentsByType.description = [ ...commentsByType.description ?? [], rest.join(' ').trim() ].join('\n')
        break
      case 'summary':
        commentsByType.summary += [ ...commentsByType.summary ?? [], rest.join(' ').trim() ].join('\n')
        break
      case 'tag':
        commentsByType.tags.push(rest.join(' ').trim())
        break
      case 'access':
        commentsByType.access = rest.join(' ').trim()
        break
      case 'private':
        commentsByType.access = 'private'
        break
      case 'public':
        commentsByType.access = 'public'
        break
      case 'deprecated':
        commentsByType.deprecated = true
        break
      case 'reply': {
        const [ status, ...details ] = rest
        if (!status) {
          break
        }

        const info = details.join(' ').split('-', 1).map(el => el.trim())
        if (!info[0]) {
          break
        }

        commentsByType.reply[status] = { description: info[0], ...info[1] ? { headers: info[1].split(',').map(el => el.trim()) } : {} }
        break
      }

      case 'note': {
        // Note is for private notes to be excluded from the schema
        break
      }

      default:
        console.warn('Unknown comment type:', head)
    }
  }

  return commentsByType
}

function parseMiddlewareComment(comments: string): MiddlewareParameters {
  const commentArray = comments.split('* @').slice(1).map(comment => {
    return comment.slice(0, -2)
  })

  const commentsByType: MiddlewareParameters = {
    requestHeaders: [],
    responses: {}
  }

  for (const comment of commentArray) {
    const [ head, ...rest ] = comment.split(' ')

    switch (head) {
      case 'requestHeader': {
        if (rest.length === 0) {
          break
        }

        if (rest.length < 2) {
          commentsByType.requestHeaders.push(rest[0] as string)
        }

        let schemaValue = {}

        try {
          schemaValue = JSON.parse(rest.slice(1).join(' ')) as object
        } catch (error) {
          console.error('Error parsing JSON:', error)
          break
        }

        commentsByType.requestHeaders.push({ name: rest[0] as string, schema: schemaValue })
        break
      }

      case 'responseHeader': {
        if (rest.length < 3) {
          break
        }

        let headerIn = {}

        try {
          headerIn = JSON.parse(rest.slice(2).join(' ')) as object
        } catch (error) {
          console.error('Error parsing JSON:', error)
          break
        }

        commentsByType.responses[rest[0] as string] = { name: rest[1] as string, ...headerIn }
        break
      }

      default:
        console.warn('Unknown comment type for middleware:', head)
    }
  }

  return commentsByType
}
