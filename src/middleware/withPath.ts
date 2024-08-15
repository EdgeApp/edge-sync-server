import { match, MatchFunction, ParamData } from 'path-to-regexp'
import { Serverlet } from 'serverlet'

export interface PathParamsRequest {
  readonly params: ParamData
}

/**
 * Serverlet middleware which picks a server based on a express-style path.
 *
 * @param paths A map of paths to serverlets.
 * @param fallback A serverlet to use when the path is not found.
 *  @returns A serverlet that picks the correct serverlet from the paths map.
 */
export function withPath<In extends { path: string }>(
  paths: { [path: string]: Serverlet<In & PathParamsRequest> },
  fallback: Serverlet<In> = async () => ({ status: 404 })
): Serverlet<In> {
  // Convert the routes to regular expressions:
  const table: Array<{
    matcher: MatchFunction<ParamData>
    server: Serverlet<In & PathParamsRequest>
  }> = []
  for (const path of Object.keys(paths)) {
    table.push({
      matcher: match(path),
      server: paths[path]
    })
  }

  return request => {
    for (const { matcher, server } of table) {
      const matchResult = matcher(request.path)
      if (matchResult !== false) {
        const extendedRequest = ({
          ...request,
          params: matchResult.params
        } as unknown) as In & PathParamsRequest
        return server(extendedRequest)
      }
    }
    return fallback(request)
  }
}
