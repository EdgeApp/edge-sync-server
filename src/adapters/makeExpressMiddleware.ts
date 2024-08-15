import { RequestHandler } from 'express'
import { HttpHeaders, HttpRequest, HttpResponse, Serverlet } from 'serverlet'

// The specific request type `makeExpressRoute` passes to its serverlet:
export interface ExpressRequest extends HttpRequest {
  readonly body?: unknown
}

/**
 * Converts a simple server function to an express.js route.
 */
export function makeExpressMiddleware(
  server: Serverlet<ExpressRequest>
): RequestHandler {
  return async function route(req, res, next) {
    const headers: HttpHeaders = {}
    for (const header of Object.keys(req.headers)) {
      const value = req.headers[header]
      if (typeof value === 'string') headers[header] = value
    }
    const request: ExpressRequest = {
      method: req.method,
      path: req.path,
      version: `HTTP/${req.httpVersion}`,
      headers,
      body: req.body
    }

    try {
      const response = await server(request)
      const { status = 200, headers = {}, body } = response

      // Not Implemented means that the Serverlet is handing off the request
      // to the next express middleware:
      if (status === 501) {
        next()
        return
      }

      res.set(headers)
      if (body == null) {
        res.status(status).send()
      } else if (typeof body === 'string') {
        res.status(status).send(body)
      } else {
        res.status(status).send(Buffer.from(body))
      }
    } catch (error) {
      next(error)
    }
  }
}

// Route to handoff the request to the next express middleware
export const nextRoute = async (): Promise<HttpResponse> => {
  return { status: 501 }
}
