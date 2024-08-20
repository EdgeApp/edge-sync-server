import { Serverlet } from 'serverlet'

/**
 * An HTTP endpoint, which knows how to handle one or more HTTP methods.
 * Returns `405 - Method Not Allowed` errors for unknown methods,
 * and adds a default `OPTIONS` handler if needed.
 *
 * @param methods An object mapping HTTP method names to serverlets.
 * @param fallback A serverlet to use when the method is not found.
 * @returns A serverlet that picks the correct serverlet from the methods map.
 */
export function withMethod<In extends { readonly method: string }>(
  methods: {
    [method: string]: Serverlet<In>
  },
  fallback?: Serverlet<In>
): Serverlet<In> {
  // Uppercase the method names:
  const cleanMethods: { [method: string]: Serverlet<In> } = {}
  for (const name of Object.keys(methods)) {
    cleanMethods[name.toUpperCase()] = methods[name]
  }

  // Add a default OPTIONS handler:
  if (cleanMethods.OPTIONS == null) {
    cleanMethods.OPTIONS = () => {
      return { status: 204, headers: optionsHeaders }
    }
  }
  const optionsHeaders = {
    'content-length': '0',
    allow: Object.keys(cleanMethods).join(', ')
  }

  return request => {
    const handler = cleanMethods[request.method]
    if (handler != null) return handler(request)
    if (fallback != null) return fallback(request)
    return { status: 405, headers: optionsHeaders }
  }
}
