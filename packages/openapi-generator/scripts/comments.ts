import { parse } from '@babel/parser'
// eslint-disable-next-line import/no-named-default
import { default as traverse } from '@babel/traverse'
import type { Paths } from './types'
import type { ObjectProperty } from '@babel/types'


type JSDocParameters = {
  description: string
  summary: string
  tags: string[]
}

export function attachComments(code: string, paths: Paths) {
  const astree = parse(code, { attachComment: true, plugins: [], sourceType: 'module' })
  if (astree.errors) {
    console.error(astree.errors)
    return
  }

  for (const [ key, value ] of Object.entries(paths)) {
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

      traverse(astree, {
        ExpressionStatement(path) {
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
          const doc = parseComment(path.node.leadingComments.map(comment => comment.value).join('\n'))
          const propertiesArray = params.properties.filter(property => property.type === 'ObjectProperty') as ObjectProperty[]

          const compatibilityDateValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'compatibilityDate')?.value
          const methodValue = propertiesArray.find(property => property.key.type === 'Identifier' && property.key.name === 'method')?.value
          const commentDate = compatibilityDateValue?.type === 'StringLiteral' ? compatibilityDateValue.value : ''
          const commentMethod = code.slice(methodValue?.start ?? 0, methodValue?.end ?? 0).replaceAll('\'"', '').replace(/.*\./, '')

          if (commentMethod !== methodToCompare) {
            return
          }
          if (commentDate !== dateToCompare) {
            return
          }
          operation.description = doc.description
          operation.summary = doc.summary
          operation.tags = doc.tags
        }
      })
    }
  }
}


function parseComment(comments: string): JSDocParameters {
  const commentArray = comments.split('* @').slice(1).map(comment => {
    return comment.slice(0, -2)
  })

  const commentsByType: JSDocParameters = {
    description: '',
    summary: '',
    tags: []
  }

  for (const comment of commentArray) {
    const [ head, ...rest ] = comment.split(' ')
    switch (head) {
      case 'description':
        commentsByType.description = `${rest.join(' ').trim()}\n`
        break
      case 'summary':
        commentsByType.summary = `${rest.join(' ').trim()}\n`
        break
      case 'tag':
        commentsByType.tags.push(rest.join(' ').trim())
        break
      default:
        console.warn('Unknown comment type:', head)
    }
  }
  return commentsByType
}
