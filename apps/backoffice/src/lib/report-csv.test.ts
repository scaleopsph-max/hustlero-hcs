import { readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { expect, it } from 'vitest'
import { reportCsv } from './report-csv'

it.each([
  '=1+1',
  '+SUM(1)',
  '-SUM(1)',
  '@SUM(1)',
  '  =1+1',
  '\t=1+1',
  '\r=1+1',
  '\n=1+1',
  '\uFEFF=1+1',
  '\0=1+1',
  ' \t@SUM(1)',
  '\tplain',
])('exports formula-like or control-prefixed text %j as literal text', (label) => {
  const parsed = Papa.parse<string[]>(reportCsv([[label]]), { delimiter: ',' })
  expect(parsed.errors).toEqual([])
  expect(parsed.data).toEqual([[`'${label}`]])
})

it('keeps signed numeric financial values numeric rather than apostrophe-prefixed strings', () => {
  const values = [-123.45, 0, 123.45]
  expect(Papa.parse<string[]>(reportCsv([values]), { delimiter: ',' }).data).toEqual([['-123.45', '0', '123.45']])
  expect(reportCsv([values])).not.toContain("'")
})

it('round-trips commas, quotes, CR/LF and ordinary labels without altering them', () => {
  const values = ['Store, Main', 'Item "A"', 'Line 1\rLine 2', 'Line 1\nLine 2', 'Shirt', "'already literal"]
  const parsed = Papa.parse<string[]>(reportCsv([values]), { delimiter: ',' })
  expect(parsed.errors).toEqual([])
  expect(parsed.data).toEqual([values])
})

it('round-trips an escaped formula containing quotes and a comma', () => {
  expect(Papa.parse<string[]>(reportCsv([['=SUM(1,2)&"x"']]), { delimiter: ',' }).data).toEqual([['\'=SUM(1,2)&"x"']])
})

it('uses the guarded serializer at the actual general Reports download boundary', () => {
  // Every Reports tab (including the reseller portal tab) downloads through report-parts.
  const parts = readFileSync(new URL('../components/report-parts.tsx', import.meta.url), 'utf8')
  expect(parts).toContain("import { reportCsv } from '@/lib/report-csv'")
  expect(parts).toContain('new Blob([reportCsv(rows)]')
  for (const file of ['ReportingWorkspace.tsx', 'ResellerPortalReportView.tsx']) {
    const source = readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8')
    expect(source).toContain("from './report-parts'")
    expect(source).not.toContain('function csvCell(')
    expect(source).not.toContain('new Blob(')
  }
})
