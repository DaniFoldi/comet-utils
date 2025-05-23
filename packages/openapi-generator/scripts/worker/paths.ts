import { Method, Server, type Route } from '@neoaren/comet'
import { methods } from './methods'
import { routeToOpenApiOperation } from './operation'
import type { Paths } from '../types'
import { nullToString } from './utils'


function compareDatesBeforeToday(
  input1: string | undefined,
  input2: string | undefined,
  target: string
): Date | undefined {
  let date1 = input1 === undefined ? undefined : new Date(input1)
  let date2 = input2 === undefined ? undefined : new Date(input2)
  let today: Date
  // eslint-disable-next-line unicorn/prefer-ternary
  if (target === 'today') {
    today = new Date(`${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`)
  } else {
    today = new Date(target)
  }

  if (date1 !== undefined) {
    date1 = date1 > today ? undefined : date1
  }

  if (date2 !== undefined) {
    date2 = date2 > today ? undefined : date2
  }

  if (date1 === undefined && date2 === undefined) {
    return
  } else if (date1 === undefined || date2 === undefined) {
    return date1 === undefined ? date2 : date1
  }

  // eslint-disable-next-line unicorn/prefer-math-min-max
  return date1 > date2 ? date1 : date2
}

export function buildPaths(server: Server<never, never, never>, routes: Route[], targetDate: string): Paths {
  const flattenedRoutes: Route[] = routes.flatMap(route => route.method === Method.ALL ? methods.map(method => ({
    ...route,
    method
  })) : [ route ])

  const groupedRoutes = flattenedRoutes.reduce((groups, thisRoute) => {
    const path = nullToString(Server.getOptions(server).prefix) + thisRoute.pathname

    groups[path] = groups[path] ?? {}
    groups[path]![thisRoute.method] = groups[path]![thisRoute.method] ?? []
    groups[path]![thisRoute.method]!.push(thisRoute)

    return groups
  }, {} as Record<string, Record<string, Route[]>>)

  const ungroupedRoutes: { [pathname: string]: Route[] } = {}

  Object.entries(groupedRoutes).map(([ pathname, routeMethods ]) => {
    const foundRoutes: Route[] = []

    for (const method of Object.values(routeMethods)) {
      if (method.length > 1) { // routes with multiple dates
        let correctMethod: Route | null = null

        for (const object of method) {
          if (correctMethod === null) {
            correctMethod = object
          } else {
            const comparedDate = compareDatesBeforeToday(
              correctMethod.compatibilityDate,
              object.compatibilityDate,
              targetDate
            )
            if (comparedDate) {
              const objectCompatibilityDate = new Date(object.compatibilityDate as string)
              if (comparedDate.getTime() === objectCompatibilityDate.getTime()) {
                correctMethod = object
              }
            }
          }
        }

        if (correctMethod) {
          foundRoutes.push(correctMethod)
        }
      } else {
        const route = method[0]
        if (route) {
          foundRoutes.push(route)
        }
      }
    }

    ungroupedRoutes[pathname] = foundRoutes
  })

  return Object.fromEntries(Object.entries(ungroupedRoutes).map(([ pathname, cometRoutes ]) => {
    return [
      ((pathname.startsWith('/') ? pathname : `/${pathname}`) as `/${string}`)
      // eslint-disable-next-line security/detect-non-literal-regexp
        .replace(new RegExp(`^${nullToString(Server.getOptions(server).prefix)
          .replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}`), ''),
      Object.fromEntries(cometRoutes.map(route => [ route.method.toLowerCase(), routeToOpenApiOperation(route) ]))
    ]
  }))
}
