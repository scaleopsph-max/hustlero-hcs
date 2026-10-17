import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'
import { expect, it } from 'vitest'

it.each([
  ['apps/admin/src/components/PlatformConsole.tsx', 1],
  ['apps/backoffice/src/app/setup/page.tsx', 2],
] as const)('keeps every logout in %s local to its own session', async (path, count) => {
  const text = readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const calls: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'signOut'
    )
      calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(calls).toHaveLength(count)
  for (const call of calls) {
    const argument = call.arguments[0]
    const scopeProperty =
      argument && ts.isObjectLiteralExpression(argument)
        ? argument.properties.find(
            (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'scope',
          )
        : undefined
    const scope =
      scopeProperty && ts.isPropertyAssignment(scopeProperty) && ts.isStringLiteral(scopeProperty.initializer)
        ? scopeProperty.initializer.text
        : undefined
    const logoutScopes: Array<string | null> = []
    const user = {
      id: '10000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    }
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.${Buffer.alloc(32, 1).toString('base64url')}`
    const client = createClient('https://synthetic.invalid', 'synthetic-publishable-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          const url = new URL(String(input))
          if (url.pathname.endsWith('/user'))
            return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } })
          if (url.pathname.endsWith('/logout')) {
            logoutScopes.push(url.searchParams.get('scope'))
            return new Response(null, { status: 204 })
          }
          throw new Error('Unexpected mock route; no real network transport')
        },
      },
    })
    expect((await client.auth.setSession({ access_token: token, refresh_token: 'synthetic-refresh' })).error).toBeNull()
    const options = scope === undefined ? undefined : { scope: scope as 'local' }
    expect((await client.auth.signOut(options)).error).toBeNull()
    expect(logoutScopes).toEqual(['local'])
  }
})
