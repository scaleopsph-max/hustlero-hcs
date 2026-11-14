'use client'

import type { ResellerAddress } from '@hcs/contracts'
import { useEffect, useId, useState } from 'react'

import { loadBarangays, loadProvinces, type Place, type Province } from '@/lib/ph-address'

export interface AddressDraft {
  provinceCode: string
  cityCode: string
  barangayCode: string
  line: string
}
export const emptyAddressDraft: AddressDraft = { provinceCode: '', cityCode: '', barangayCode: '', line: '' }

/** The complete address, or null while a choice or the house details are missing. */
export function addressFromDraft(
  draft: AddressDraft,
  provinces: Province[],
  barangays: Record<string, Place[]>,
): ResellerAddress | null {
  const province = provinces.find((entry) => entry.code === draft.provinceCode)
  const city = province?.cities.find((entry) => entry.code === draft.cityCode)
  const barangay = barangays[draft.cityCode]?.find((entry) => entry.code === draft.barangayCode)
  if (!province || !city || !barangay || draft.line.trim().length < 5) return null
  return {
    line: draft.line.trim(),
    barangayCode: barangay.code,
    barangay: barangay.name,
    cityCode: city.code,
    city: city.name,
    provinceCode: province.code,
    province: province.name,
  }
}

/**
 * Province, then city or municipality, then barangay, all from the official PSGC lists, plus the house
 * number, street, and building typed in. Used for delivery, so each part is required.
 */
export function AddressPicker({
  value,
  onChange,
  onLists,
}: {
  value: AddressDraft
  onChange: (next: AddressDraft) => void
  /** Hands the loaded lists back so the form can build the final address. */
  onLists: (provinces: Province[], barangays: Record<string, Place[]>) => void
}) {
  const id = useId()
  const [provinces, setProvinces] = useState<Province[] | null>(null)
  const [barangays, setBarangays] = useState<Record<string, Place[]>>({})
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    loadProvinces()
      .then(setProvinces)
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'The address list did not load.'))
  }, [])

  useEffect(() => {
    if (!value.provinceCode) return
    let active = true
    loadBarangays(value.provinceCode)
      .then((loaded) => {
        if (active) setBarangays(loaded)
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'The address list did not load.'))
    return () => {
      active = false
    }
  }, [value.provinceCode])

  useEffect(() => {
    if (provinces) onLists(provinces, barangays)
  }, [provinces, barangays, onLists])

  const province = provinces?.find((entry) => entry.code === value.provinceCode)
  const cityOptions = province?.cities ?? []
  const barangayOptions = value.cityCode ? (barangays[value.cityCode] ?? []) : []

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-sm font-semibold">Delivery address</legend>
      {problem ? <p className="text-small text-signal-dark-critical-fg">{problem}</p> : null}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-province`} className="text-small text-ink-200">
          Province
        </label>
        <select
          id={`${id}-province`}
          className="field"
          required
          disabled={!provinces}
          value={value.provinceCode}
          onChange={(event) => onChange({ ...value, provinceCode: event.target.value, cityCode: '', barangayCode: '' })}
        >
          <option value="">{provinces ? 'Choose a province' : 'Loading…'}</option>
          {provinces?.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-city`} className="text-small text-ink-200">
          City or municipality
        </label>
        <select
          id={`${id}-city`}
          className="field"
          required
          disabled={!province}
          value={value.cityCode}
          onChange={(event) => onChange({ ...value, cityCode: event.target.value, barangayCode: '' })}
        >
          <option value="">{province ? 'Choose a city or municipality' : 'Choose a province first'}</option>
          {cityOptions.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-barangay`} className="text-small text-ink-200">
          Barangay
        </label>
        <select
          id={`${id}-barangay`}
          className="field"
          required
          disabled={!value.cityCode || barangayOptions.length === 0}
          value={value.barangayCode}
          onChange={(event) => onChange({ ...value, barangayCode: event.target.value })}
        >
          <option value="">
            {!value.cityCode ? 'Choose a city first' : barangayOptions.length ? 'Choose a barangay' : 'Loading…'}
          </option>
          {barangayOptions.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-line`} className="text-small text-ink-200">
          House no., street, building or subdivision
        </label>
        <textarea
          id={`${id}-line`}
          className="field h-auto min-h-20 py-3"
          required
          minLength={5}
          maxLength={200}
          autoComplete="street-address"
          placeholder="e.g. Blk 4 Lot 12, Mabini St., Villa Rosa Subd."
          value={value.line}
          onChange={(event) => onChange({ ...value, line: event.target.value })}
        />
      </div>
    </fieldset>
  )
}
