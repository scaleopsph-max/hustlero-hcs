import { environmentSchema } from '@hcs/contracts'

export interface Bindings {
  ENVIRONMENT: string
}

export function readEnvironment(bindings: Bindings) {
  return environmentSchema.parse(bindings.ENVIRONMENT)
}
