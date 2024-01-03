import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import type { Paths } from './types'
import type { ObjectProperty } from '@babel/types'


type JSDocParameters = {
  access: string
  description: string
  summary: string
  tags: string[]
}

export function attachComments(code: string, paths: Paths, access: string) {
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

      let dateToCompare: string
      // TODO

      // @ts-expect-error This babel traverse types are wrong
      babelTraverse.default(astree, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ExpressionStatement(path: any) {
          if (!path.node.leadingComments) {
            return
          }

          if (path.node.expression.type !== 'CallExpression') {
            return
          }

          const params = path.node.expression.arguments[0]
          if (!params || params.type !== 'ObjectExpression') {
            return
          }

          const propertiesArray = params.properties.filter((property: any) => property.type === 'ObjectProperty') as ObjectProperty[]

          const compatibilityDateValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'compatibilityDate')?.value
          const methodValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'method')?.value
          const pathnameValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'pathname')?.value
          const commentDate = compatibilityDateValue?.type === 'StringLiteral' ? compatibilityDateValue.value : ''
          const commentMethod = code.slice(methodValue?.start ?? 0, methodValue?.end ?? 0).replaceAll('\'"', '').replace(/.*\./, '')

          if (commentMethod !== methodToCompare) {
            return
          }

          if (commentDate !== dateToCompare) {
            return
          }

          if (pathnameValue?.type === 'StringLiteral' && pathnameValue.value !== key) {
            return
          }

          const doc = parseComment(path.node.leadingComments.map((comment: any) => comment.value).join('\n'))
          operation.description = doc.description
          operation.summary = doc.summary
          operation.tags = doc.tags
          // @ts-expect-error This could be typed, but it's fine :tm:
          operation.access = doc.access
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


function parseComment(comments: string): JSDocParameters {
  const commentArray = comments.split('* @').slice(1).map(comment => {
    return comment.slice(0, -2)
  })

  const commentsByType: JSDocParameters = {
    access: '',
    description: '',
    summary: '',
    tags: []
  }

  for (const comment of commentArray) {
    const [ head, ...rest ] = comment.split(' ')

    switch (head) {
      case 'description':
        commentsByType.description = [ commentsByType.description || undefined, rest.join(' ').trim() ].join('\n')
        break
      case 'summary':
        commentsByType.summary += [ commentsByType.summary || undefined, rest.join(' ').trim() ].join('\n')
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
      default:
        console.warn('Unknown comment type:', head)
    }
  }

  return commentsByType
}
