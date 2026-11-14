import type { ResellerAddress } from '@hcs/contracts'

/** One place in the address picker: its PSGC code and name. */
export interface Place {
  code: string
  name: string
}
export interface Province extends Place {
  cities: Place[]
}

type IndexFile = { provinces: [string, string, [string, string][]][] }
type BarangayFile = Record<string, [string, string][]>

const toPlace = ([code, name]: [string, string]): Place => ({ code, name })

let provincesRequest: Promise<Province[]> | null = null
const barangayRequests = new Map<string, Promise<Record<string, Place[]>>>()

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error('The address list did not load. Check your connection and try again.')
  return (await response.json()) as T
}

/** Provinces with their cities and municipalities (about 45 KB, loaded once). */
export function loadProvinces(): Promise<Province[]> {
  provincesRequest ??= getJson<IndexFile>('/ph-address/index.json')
    .then((file) => file.provinces.map(([code, name, cities]) => ({ code, name, cities: cities.map(toPlace) })))
    .catch((error: unknown) => {
      provincesRequest = null
      throw error
    })
  return provincesRequest
}

/** Barangays of every city in one province, keyed by city code. */
export function loadBarangays(provinceCode: string): Promise<Record<string, Place[]>> {
  let request = barangayRequests.get(provinceCode)
  if (!request) {
    request = getJson<BarangayFile>(`/ph-address/barangays/${provinceCode}.json`)
      .then((file) => Object.fromEntries(Object.entries(file).map(([city, list]) => [city, list.map(toPlace)])))
      .catch((error: unknown) => {
        barangayRequests.delete(provinceCode)
        throw error
      })
    barangayRequests.set(provinceCode, request)
  }
  return request
}

/** "Blk 4 Lot 12, Mabini St., Brgy. Kaybagal Central, Tagaytay City, Cavite" */
export function formatAddress(address: ResellerAddress): string {
  const barangay = /^(barangay|brgy\.?)\s/i.test(address.barangay) ? address.barangay : `Brgy. ${address.barangay}`
  return [address.line.trim(), barangay, address.city, address.province].join(', ')
}
