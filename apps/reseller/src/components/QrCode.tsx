'use client'

import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** A QR code drawn as SVG squares (no HTML injection). */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()
    const modules = code.getModuleCount()
    let d = ''
    for (let row = 0; row < modules; row += 1)
      for (let col = 0; col < modules; col += 1) if (code.isDark(row, col)) d += `M${col + 2},${row + 2}h1v1h-1z`
    return { path: d, count: modules + 4 }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      className="rounded-[12px] bg-white"
    >
      <path d={path} fill="#111" />
    </svg>
  )
}
