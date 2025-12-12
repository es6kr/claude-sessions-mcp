import { json } from '@sveltejs/kit'
import { Effect } from 'effect'
import * as session from '$lib/server/session'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const projectName = url.searchParams.get('project') ?? undefined
  const result = await Effect.runPromise(session.previewCleanup(projectName))
  return json(result)
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    project?: string
    clearEmpty?: boolean
    clearInvalid?: boolean
  }
  const result = await Effect.runPromise(
    session.clearSessions({
      projectName: body.project,
      clearEmpty: body.clearEmpty,
      clearInvalid: body.clearInvalid,
    })
  )
  return json(result)
}
