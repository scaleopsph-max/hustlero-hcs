// Writes the Philippine province, city, and barangay lists the reseller portal's address picker loads.
// Source: PSGC (Philippine Statistics Authority) via @aivangogh/ph-address. Rerun after upgrading that package:
//   node scripts/generate-ph-address.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAllBarangays, getAllMunicipalities, getAllProvinces } from '@aivangogh/ph-address'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'apps/reseller/public/ph-address')
const version = JSON.parse(readFileSync(join(root, 'node_modules/@aivangogh/ph-address/package.json'), 'utf8')).version

// Places PSGC files under something other than a province, shown as one in the picker.
const extraProvinces = {
  1300000000: 'Metro Manila',
  1999900000: 'Special Geographic Area (BARMM)',
  '0990100000': 'City of Isabela',
}
const manila = '1380600000'

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })
const provinces = new Map(getAllProvinces().map((p) => [p.psgcCode, p.name]))
for (const [code, name] of Object.entries(extraProvinces)) provinces.set(code, name)

const municipalities = getAllMunicipalities()
// Manila's districts (Tondo, Sampaloc, ...) are folded into Manila City: resellers pick Manila, then the barangay.
const manilaDistricts = new Set(municipalities.filter((m) => m.provinceCode === manila).map((m) => m.psgcCode))
const cities = municipalities.filter((m) => m.provinceCode !== manila)
const missing = cities.filter((m) => !provinces.has(m.provinceCode))
if (missing.length) throw new Error(`No province for ${missing.map((m) => m.name).join(', ')}`)

const barangaysByCity = new Map()
for (const b of getAllBarangays()) {
  const city = manilaDistricts.has(b.municipalCityCode) ? manila : b.municipalCityCode
  if (!barangaysByCity.has(city)) barangaysByCity.set(city, [])
  barangaysByCity.get(city).push(b)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'barangays'), { recursive: true })

const index = [...provinces.entries()]
  .map(([code, name]) => ({
    code,
    name,
    cities: cities
      .filter((m) => m.provinceCode === code)
      .sort(byName)
      .map((m) => [m.psgcCode, m.name]),
  }))
  .filter((p) => p.cities.length > 0)
  .sort(byName)

for (const province of index) {
  const lists = Object.fromEntries(
    province.cities.map(([code]) => {
      const list = (barangaysByCity.get(code) ?? []).sort(byName).map((b) => [b.psgcCode, b.name])
      if (!list.length) throw new Error(`No barangays for ${code}`)
      return [code, list]
    }),
  )
  writeFileSync(join(out, 'barangays', `${province.code}.json`), JSON.stringify(lists))
}
writeFileSync(
  join(out, 'index.json'),
  JSON.stringify({
    source: `PSGC via @aivangogh/ph-address ${version}`,
    provinces: index.map((p) => [p.code, p.name, p.cities]),
  }),
)
console.log(
  `${index.length} provinces, ${cities.length} cities and municipalities, ${barangaysByCity.size} barangay lists`,
)
