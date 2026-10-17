import Papa from 'papaparse'

export function reportCsv(rows: Array<Array<string | number>>): string {
  return Papa.unparse(rows, {
    newline: '\r\n',
    // Guard text after whitespace/control prefixes; Papa leaves numeric cells numeric.
    escapeFormulae: /^(?:[\s\p{Cc}]*[=+\-@]|[\t\r\n])/u,
  })
}
