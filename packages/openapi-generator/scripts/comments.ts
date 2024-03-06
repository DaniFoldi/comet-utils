import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import type { Paths } from './types'
import type { ObjectProperty } from '@babel/types'
import { NodePath } from '@babel/traverse'
import * as t from '@babel/types'


type JSDocParameters = {
  access: string
  description: string
  summary: string
  tags: string[]
  reply: Record<string, { description: string; headers: string[] }>
}

type MiddlewareParameters<T = any> = {
  requestHeaders: (string | { name: string } & T)[],
  responses: Record<string, { name: string } & T>
}

export function attachComments(code: string, paths: Paths, access: string, date: string, middlewares: { name: string, params:  MiddlewareParameters<any> }[]) {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        enter(path: any) {
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

            const propertiesArray = params.properties.filter((property: any) => property.type === 'ObjectProperty') as ObjectProperty[]

            const beforeValue = propertiesArray.find((property) => property.key.type === "Identifier" && property.key.name === "before")?.value;
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

            const commonMWs = middlewares.length > 0 && beforeNames !== null ? middlewares.filter(element => beforeNames.includes(element.name)) : []
            const doc = parseComment(path.node.leadingComments.map((comment: any) => comment.value).join('\n'))
            operation.description = doc.description
            operation.summary = doc.summary
            operation.tags = doc.tags

            const replyKey = Object.keys(doc.reply)[0] as string
            operation.responses = { [replyKey]: { description: doc.reply[replyKey]?.description as string, headers: (doc.reply[replyKey]?.headers || []) as {} } }
            commonMWs.map(mw => {
              Object.entries(mw.params.responses).map(([key, value]) => {
                if (!(key in operation.responses)){
                  operation.responses[key] = value
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

      // @ts-expect-error This could be typed, but it's fine :tm:
      delete operation.access
    }

    if (Object.keys(paths[key]).length === 0) {
      delete paths[key]
    }
  }
}

export function collectMiddlewares(code: string): { name: string, params:  MiddlewareParameters<any> }[] {
  const middlewares: { name: string, params:  MiddlewareParameters<any> }[] = []
  const astree = parse(code, { attachComment: true, plugins: [], sourceType: 'module' })
  if (astree.errors.length > 0) {
    console.error(astree.errors)
    return middlewares
  }

  const commentsByLine = new Map();

  babelTraverse.default(astree, {
    enter(path: any) {
      if (path.node.leadingComments) {
        const line = path.node.loc.start.line;
        commentsByLine.set(line, path.node.leadingComments.map(comment => comment.value));
      }
    }
  });

  babelTraverse.default(astree, {
    CallExpression(path: any) {
      if (path.node.callee.type === 'Identifier' && path.node.callee?.name === 'middleware') {
        let middlewareName = '';
        const variableDeclaration = path.findParent((parent: NodePath<t.VariableDeclarator>) => parent.isVariableDeclarator());
        if (!variableDeclaration) {
          return;
        }
        middlewareName = variableDeclaration.node.id?.name;

        const line = path.node.loc.start.line;
        const comments = commentsByLine.get(line);
        if (!comments) {
          return;
        }
        const doc = parseMiddlewareComment(comments.map((comment: string) => comment).join("\n"));
        middlewares.push({ name: middlewareName, params: doc })
      }
    }
  });

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
        commentsByType.description = [ ...commentsByType.description ? commentsByType.description : [], rest.join(' ').trim() ].join('\n')
        break
      case 'summary':
        commentsByType.summary += [ ...commentsByType.summary ? commentsByType.summary : [] || undefined, rest.join(' ').trim() ].join('\n')
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
      case 'reply':
        const info = rest.join(' ').split('-').map(el => el.trim())
        if (info.length < 2) {
          break
        }

        commentsByType.reply[info[0] as string] = { description: info[1] as string, headers: info[2] ? info[2].split(',').map(el => el.trim()) : [] }
        break
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
    let valueParam = []

    switch (head) {
      case 'request':
        commentsByType.requestHeaders.push(rest.length > 1 ? { name: rest[0] as string, type: rest[1] as string } : rest.join(' ').trim())
        break

      case 'requestHeader':
        commentsByType.requestHeaders.push(rest.length > 1 ? { name: rest[0] as string, type: rest[1] as string } : rest.join(' ').trim())
        break

      case 'response':
        if (rest.length < 3) {
          break
        }
        valueParam = rest.slice(2).join(' ').slice(1,-1).split(': ')
        if (valueParam.length < 2){
          commentsByType.responses[rest[0] as string] = { name: rest[1] }
          break
        }
        commentsByType.responses[rest[0] as string] = { name: rest[1] as string, [valueParam[0]?.slice(1,-1) as string] : valueParam[1]?.slice(1,-1) }
        break

      case 'responseHeader':
        if (rest.length < 3) {
          break
        }
        valueParam = rest.slice(2).join(' ').slice(1,-1).split(': ')
        if (valueParam.length < 2){
          commentsByType.responses[rest[0] as string] = { name: rest[1] }
          break
        }
        commentsByType.responses[rest[0] as string] = { name: rest[1] as string, [valueParam[0]?.slice(1,-1) as string] : valueParam[1]?.slice(1,-1)  }
        break

      default:
        console.warn('Unknown comment type for middleware:', head)
    }
  }

  return commentsByType
}
