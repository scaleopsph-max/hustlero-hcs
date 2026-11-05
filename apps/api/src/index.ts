import { app } from './app'
import type { Bindings } from './env'
import { createScheduledHandler } from './scheduled'

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<Bindings>
