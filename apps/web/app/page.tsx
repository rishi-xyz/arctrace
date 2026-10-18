import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, FileSearch, FileText, Fingerprint, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge, Button, Card } from '../components/ui';

const features = [
  { icon: LockKeyhole, title: 'Encrypted in your browser', body: 'Documents are encrypted before upload. Private keys stay on the device where they are created.' },
  { icon: Fingerprint, title: 'A distinct record for every open', body: 'Each authorized open is signed by the reader and recorded in a tamper-evident Arkiv ledger.' },
  { icon: FileSearch, title: 'Investigate a leak with evidence', body: 'Check a leaked copy for its watermark, verify the matching signature, and export the evidence bundle.' },
];

export default function Home() {
  return <main className="overflow-hidden bg-paper">
    <header className="relative z-10 mx-auto flex h-[76px] max-w-[1240px] items-center justify-between px-5 md:px-8">
      <Link href="/" className="flex items-center gap-2.5" aria-label="ArcTrace home"><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-ink text-white"><ShieldCheck size={19} /></span><span className="text-[18px] font-semibold tracking-[-.05em]">arctrace<span className="text-moss">.</span></span></Link>
      <nav className="hidden items-center gap-8 text-sm text-[#65736b] md:flex"><a href="#how-it-works" className="hover:text-ink">How it works</a><a href="#security" className="hover:text-ink">Security</a><Link href="/demo" className="hover:text-ink">Try sample</Link></nav>
      <div className="flex items-center gap-2"><Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/auth">Sign in</Link></Button><Button asChild><Link href="/auth?mode=register">Get started <ArrowRight size={15} /></Link></Button></div>
    </header>

    <section className="relative mx-auto grid max-w-[1240px] items-center gap-14 px-5 pb-20 pt-12 md:px-8 md:pb-28 md:pt-20 lg:grid-cols-[1.02fr_.98fr]">
      <div className="relative z-10 max-w-[600px]">
        <Badge tone="green"><Sparkles size={13} className="mr-1.5" /> PRIVATE DOCUMENT WORKSPACE</Badge>
        <h1 className="mt-7 text-[46px] font-semibold leading-[1.04] tracking-[-.055em] sm:text-[58px] lg:text-[66px]">Share sensitive files.<br /><span className="text-moss">Keep a record of every open.</span></h1>
        <p className="mt-6 max-w-[500px] text-[16px] leading-7 text-[#69776e]">ArcTrace helps teams share encrypted documents and investigate leaks with unique watermarks and signed, tamper-evident records.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3"><Button asChild className="h-11 px-5"><Link href="/auth?mode=register">Create your workspace <ArrowRight size={16} /></Link></Button><Button asChild variant="outline" className="h-11 px-5"><Link href="/auth">Sign in</Link></Button></div>
        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#718077]"><span className="flex items-center gap-2"><Check size={14} className="text-moss" /> Client-side encryption</span><span className="flex items-center gap-2"><Check size={14} className="text-moss" /> Verifiable open history</span></div>
      </div>

      <div className="relative mx-auto w-full max-w-[510px] lg:ml-auto">
        <div className="absolute -right-28 -top-24 h-[440px] w-[440px] rounded-full border border-[#dfe6dc]" /><div className="absolute -right-10 -top-6 h-[330px] w-[330px] rounded-full border border-[#e5e9e2]" />
        <Card className="relative overflow-hidden border-[#e2e8df] shadow-[0_24px_80px_-32px_rgba(19,35,30,.22)]">
          <div className="flex items-center justify-between border-b border-line px-5 py-4"><div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#edf3ed] text-moss"><FileText size={16} /></span><div><div className="text-xs font-semibold">Protected documents</div><div className="mt-0.5 text-[10px] text-[#89938c]">Workspace overview</div></div></div><span className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[10px] font-medium text-[#53645c]">+ Share file</span></div>
          <div className="p-5">
            <div className="flex items-end justify-between"><div><div className="text-[11px] text-[#89938c]">Open activity</div><div className="mt-1 text-[25px] font-semibold tracking-[-.04em]">Verified by design</div></div><span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[#e7f2e8] px-2.5 py-1 text-[10px] font-medium text-[#42704f]"><span className="h-1.5 w-1.5 rounded-full bg-[#62a274]" /> Ledger ready</span></div>
            <div className="mt-5 rounded-xl border border-line bg-[#fbfcf9] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[#718077] shadow-sm"><FileText size={18} /></div><div><div className="text-xs font-semibold">Quarterly brief.pdf</div><div className="mt-1 text-[10px] text-[#89938c]">Encrypted · 3 recipients</div></div></div><LockKeyhole size={16} className="text-moss" /></div>
              <div className="mt-4 border-t border-line pt-3"><div className="mb-2.5 flex items-center justify-between text-[10px]"><span className="font-medium text-[#53645c]">Recent verified opens</span><span className="text-[#89938c]">Today</span></div><div className="flex items-center gap-2 text-[10px] text-[#68776c]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e8efe8] font-semibold text-[#52745f]">A</span><span className="flex-1">Alex Morgan opened a copy</span><span className="font-medium text-moss">Signed</span></div><div className="mt-2 flex items-center gap-2 text-[10px] text-[#68776c]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#f0eee6] font-semibold text-[#887a58]">J</span><span className="flex-1">Jordan Lee opened a copy</span><span className="font-medium text-moss">Signed</span></div></div>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-ink px-4 py-3.5 text-white"><div className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><ShieldCheck size={17} className="text-[#b9d4bd]" /></div><div className="min-w-0 flex-1"><div className="text-[11px] font-medium">Evidence you can verify</div><div className="mt-1 truncate text-[9px] text-[#b6c4bb]">Open records are signed and anchored to Arkiv</div></div><ArrowUpRight size={15} className="text-[#b9d4bd]" /></div>
          </div>
        </Card>
        <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-line bg-white px-4 py-3 shadow-lg sm:block"><div className="flex items-center gap-2 text-[11px] font-medium"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#edf3ed] text-moss"><Fingerprint size={13} /></span> Each open leaves its own proof</div></div>
      </div>
    </section>

    <section className="border-y border-line bg-white/65" id="security"><div className="mx-auto max-w-[1240px] px-5 py-16 md:px-8 md:py-20">
      <div className="max-w-[650px]"><p className="text-xs font-semibold uppercase tracking-[.15em] text-moss">Designed for sensitive work</p><h2 className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-[38px]">Control access. Keep trustworthy evidence.</h2><p className="mt-4 text-sm leading-6 text-[#748078]">Encryption protects the document. Individual signatures and a tamper-evident ledger make each authorized open accountable.</p></div>
      <div className="mt-9 grid gap-4 md:grid-cols-3">{features.map(({ icon: Icon, title, body }, index) => <Card key={title} className="p-5 md:p-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf3ed] text-moss"><Icon size={19} /></div><div className="mt-5 text-sm font-semibold">{title}</div><p className="mt-2 text-sm leading-6 text-[#748078]">{body}</p><div className="mt-5 text-[10px] font-semibold uppercase tracking-[.13em] text-[#a0aaa2]">0{index + 1}</div></Card>)}</div>
    </div></section>

    <section id="how-it-works" className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 md:px-8 md:py-20 lg:grid-cols-[.8fr_1.2fr]">
      <div><p className="text-xs font-semibold uppercase tracking-[.15em] text-moss">How ArcTrace works</p><h2 className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-[38px]">A clear path from sharing to investigation.</h2><p className="mt-4 text-sm leading-6 text-[#748078]">Keep the document private while preserving a verifiable history of who opened it.</p><Button asChild variant="outline" className="mt-6"><Link href="/auth?mode=register">Explore the workspace <ArrowRight size={15} /></Link></Button></div>
      <div className="space-y-3">{[
        ['01', 'Share securely', 'Choose recipients. The file is encrypted in your browser before it is uploaded.'],
        ['02', 'Open with a personal key', 'The recipient unlocks their key. A signed, unique open record is committed before the watermarked copy is shown.'],
        ['03', 'Investigate with proof', 'Check a suspected leak, verify its record, and download an evidence bundle for review.'],
      ].map(([number, title, body]) => <div key={number} className="flex gap-4 rounded-xl border border-line bg-white p-4 sm:p-5"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf3ed] text-xs font-semibold text-moss">{number}</div><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1.5 text-sm leading-6 text-[#748078]">{body}</p></div></div>)}</div>
    </section>

    <section className="px-5 pb-16 md:px-8 md:pb-20"><div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-6 rounded-2xl bg-ink px-6 py-8 text-white sm:flex-row sm:items-center sm:px-10 sm:py-10"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-[#a9c6ad]">Start with a secure workspace</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em] sm:text-3xl">Make every authorized open count.</h2><p className="mt-2 text-sm text-[#c0ccc4]">Create an account and explore ArcTrace with your team.</p></div><Button asChild className="shrink-0 bg-white text-ink hover:bg-[#edf3ed]"><Link href="/auth?mode=register">Get started <ArrowRight size={15} /></Link></Button></div></section>

    <footer className="border-t border-line bg-white"><div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-5 py-6 text-xs text-[#89938c] sm:flex-row sm:items-center sm:justify-between md:px-8"><Link href="/" className="font-semibold tracking-[-.03em] text-ink">arctrace<span className="text-moss">.</span></Link><p>ArcTrace helps attribute leaks; it cannot prevent copying or screen capture. Demo workspace for manual evaluation.</p><Link href="/auth" className="font-medium text-moss hover:underline">Sign in</Link></div></footer>
  </main>;
}
