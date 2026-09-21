import { Surface } from '@hcs/ui'
import { Apps, Doubts, FinalCta, Footer, Hero, Modules, Nav, Steps, Verbs } from '@/components/sections'

/** Marketing landing page. Not defined in the product spec, so the copy is derived from it (see src/content.ts). */
export default function LandingPage() {
  return (
    <Surface
      tone="dark"
      className="min-h-screen"
      glows={[
        { color: 'gold', className: 'left-[780px] top-[60px] size-[640px] opacity-35' },
        { color: 'gray', className: '-left-52 top-[200px] size-[560px] opacity-30' },
        { color: 'gold', className: '-left-40 top-[1100px] size-[520px] opacity-15' },
        { color: 'gold', className: '-right-40 top-[1900px] size-[560px] opacity-25' },
        { color: 'gray', className: '-left-28 top-[2000px] size-[520px] opacity-30' },
        { color: 'gold', className: 'left-[500px] top-[3600px] size-[520px] opacity-20' },
        { color: 'gold', className: 'left-[200px] top-[4800px] h-[420px] w-[800px] opacity-35' },
      ]}
    >
      <div id="top" />
      <Nav />
      <Hero />
      <Verbs />
      <Apps />
      <Modules />
      <Doubts />
      <Steps />
      <FinalCta />
      <Footer />
    </Surface>
  )
}
