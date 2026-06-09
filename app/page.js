import dynamic from 'next/dynamic'

const QuinielaApp = dynamic(() => import('./QuinielaApp'), { ssr: false })

export default function Page() {
  return <QuinielaApp />
}
