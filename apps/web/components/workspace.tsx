'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowDownToLine, ArrowUpRight, Check, CircleHelp, FileLock2, FileSearch, FileText, KeyRound, LoaderCircle, LockKeyhole, LogOut, Plus, Search, ShieldCheck, Upload, Users, X } from 'lucide-react';
import { Badge, Button, Card, Input } from './ui';
import { api, establishSession, forgetCsrf, restoreSession, type SessionUser } from '../lib/api';

type Section = 'overview' | 'documents' | 'inbox' | 'investigate' | 'settings';
type Doc = { id: string; title?: string; status: string; viewMode: string; createdAt: string; senderName?: string; recipientCount?: number };
type Ledger = { mode: string; ok: boolean; latencyMs: number; explorerUrl: string; gateMode: string };

const sections: { id: Section; label: string; icon: typeof FileText }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'documents', label: 'Shared documents', icon: FileText },
  { id: 'inbox', label: 'Your inbox', icon: LockKeyhole },
  { id: 'investigate', label: 'Investigations', icon: FileSearch },
];

export function Workspace() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [openDoc, setOpenDoc] = useState<Doc | null>(null);

  useEffect(() => {
    restoreSession().then(setUser).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!loading && !user) router.replace('/auth');
  }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    api<Doc[]>('/documents').then(setDocs).catch((e) => setError(e.message));
    api<Ledger>('/ledger/status').then(setLedger).catch(() => setLedger(null));
  }, [user]);

  const greeting = useMemo(() => user?.displayName.split(' ')[0] ?? '', [user]);
  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* local UI still resets */ }
    forgetCsrf(); setUser(null); setDocs([]); setSection('overview');
  };

  if (loading) return <div className="grid min-h-screen place-items-center"><LoaderCircle className="animate-spin text-moss" /></div>;
  if (!user) return null;

  const myDocs = docs.filter((d) => d.status === 'ready');
  const inbox = myDocs.filter((d) => d.senderName && d.senderName !== user.displayName);
  return (
    <div className="min-h-screen bg-paper">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r border-line bg-white px-5 py-6 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-10 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#98a39b]">Workspace</div>
        <nav className="mt-3 space-y-1">
          {sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSection(id)} className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition ${section === id ? 'bg-[#edf3ed] font-medium text-ink' : 'text-[#64716a] hover:bg-paper'}`}><Icon size={17} strokeWidth={1.8} />{label}{id === 'inbox' && inbox.length > 0 && <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-[#65746b]">{inbox.length}</span>}</button>)}
        </nav>
        <div className="mt-9 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#98a39b]">Account</div>
        <button onClick={() => setSection('settings')} className={`mt-3 flex h-10 items-center gap-3 rounded-lg px-3 text-sm ${section === 'settings' ? 'bg-[#edf3ed] text-ink' : 'text-[#64716a] hover:bg-paper'}`}><Users size={17} />Members & keys</button>
        <div className="mt-auto rounded-xl border border-line bg-paper p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${ledger?.ok ? 'bg-[#62a274]' : 'bg-[#d4a846]'}`} />{ledger?.ok ? 'Ledger connected' : 'Ledger status unknown'}</div>
          <div className="mt-1.5 pl-4 text-[11px] text-[#748078]">{ledger?.mode ?? 'Checking connection'}{ledger?.gateMode === 'off' ? ' · demo mode' : ''}</div>
          {ledger?.explorerUrl && <a href={ledger.explorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex pl-4 text-[11px] text-moss hover:underline">Open explorer <ArrowUpRight size={12} className="ml-1" /></a>}
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#e9efe9] text-xs font-semibold text-[#52745f]">{user.displayName.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{user.displayName}</div><div className="text-[11px] capitalize text-[#89938c]">{user.role}</div></div>
          <button aria-label="Sign out" onClick={signOut} className="rounded-md p-2 text-[#7e8981] hover:bg-paper"><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="min-h-screen lg:ml-[248px]">
        <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-line bg-white/90 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-2 lg:hidden"><Brand compact /></div>
          <div className="hidden items-center gap-2 text-xs text-[#8b968e] md:flex"><span>Workspace</span><span>/</span><span className="font-medium capitalize text-[#405249]">{section === 'overview' ? 'Overview' : section.replace('-', ' ')}</span></div>
          <div className="ml-auto flex items-center gap-3"><div className="hidden items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-[#7e8981] sm:flex"><Search size={14} /><span>Search workspace</span><span className="ml-5 rounded border px-1.5 py-0.5 text-[10px]">⌘ K</span></div><button className="rounded-lg p-2 text-[#7e8981] hover:bg-paper" aria-label="Help"><CircleHelp size={18} /></button></div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-white px-4 py-2 lg:hidden">{sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSection(id)} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs ${section === id ? 'bg-[#edf3ed] text-ink' : 'text-[#69766e]'}`}><Icon size={14} />{label}</button>)}</nav>
        <div className="mx-auto max-w-[1320px] px-5 py-8 md:px-9 md:py-10">
          {error && <div role="alert" className="mb-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div>}
          {notice && <div role="status" className="mb-5 rounded-xl border border-[#cfe1d1] bg-[#f0f7f0] px-4 py-3 text-sm text-[#42684c]">{notice}</div>}
          {section === 'overview' && <Overview greeting={greeting} user={user} docs={myDocs} onNavigate={setSection} ledger={ledger} />}
          {section === 'documents' && <DocumentList docs={myDocs} onNew={() => setShowUpload(true)} />}
          {section === 'inbox' && <Inbox docs={inbox} onOpen={setOpenDoc} />}
          {section === 'investigate' && <Investigate user={user} setNotice={setNotice} setError={setError} />}
          {section === 'settings' && <Settings user={user} />}
        </div>
      </main>
      {showUpload && <UploadDialog user={user} onClose={() => setShowUpload(false)} onCreated={() => { setShowUpload(false); void api<Doc[]>('/documents').then(setDocs); setNotice('Document encrypted and shared. Ledger records are being committed.'); }} />}
      {openDoc && <OpenDialog doc={openDoc} user={user} explorerUrl={ledger?.explorerUrl} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-[10px] bg-ink text-white"><ShieldCheck size={18} /></div>{!compact && <div className="text-[17px] font-semibold tracking-[-.04em]">arctrace<span className="text-moss">.</span></div>}</div>;
}

export function AuthScreen({ mode, setMode, onSignedIn, error, setError }: { mode: 'login' | 'register'; setMode: (m: 'login' | 'register') => void; onSignedIn: (u: SessionUser) => void; error: string; setError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (form: FormData) => {
    setBusy(true); setError('');
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login'
        ? { email: form.get('email'), password: form.get('password') }
        : { email: form.get('email'), password: form.get('password'), displayName: form.get('name'), role: form.get('role') };
      onSignedIn(await establishSession(path, body));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in'); }
    finally { setBusy(false); }
  };
  return <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
    <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
      <div><Brand /><span className="sr-only">ArcTrace</span></div>
      <div className="relative z-10 max-w-[520px] pb-14"><Badge tone="green">PRIVATE DOCUMENT WORKSPACE</Badge><h1 className="mt-7 text-[42px] font-medium leading-[1.12] tracking-[-.04em] xl:text-[52px]">Share with confidence.<br /><span className="text-[#a9c6ad]">Know when it matters.</span></h1><p className="mt-6 max-w-[420px] text-[15px] leading-7 text-[#c0ccc4]">Every document stays encrypted. Every authorized open leaves a signed record, so a leak can be traced back with evidence.</p><div className="mt-10 flex items-center gap-6 text-xs text-[#c0ccc4]"><span className="flex items-center gap-2"><LockKeyhole size={15} /> Client-side encryption</span><span className="flex items-center gap-2"><ShieldCheck size={15} /> Verifiable audit trail</span></div></div>
      <div className="absolute -right-24 top-[18%] h-[450px] w-[450px] rounded-full border border-white/[.07]" /><div className="absolute -right-6 top-[25%] h-[320px] w-[320px] rounded-full border border-white/[.06]" />
      <div className="text-xs text-[#9aa99f]">Built for teams handling sensitive documents</div>
    </section>
    <section className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-[410px]">
        <div className="mb-10 lg:hidden"><Brand /></div>
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-[#748078] hover:text-ink">← Back to ArcTrace</Link>
        <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[.15em] text-moss">Welcome to ArcTrace</p><h2 className="mt-3 text-3xl font-semibold tracking-[-.04em]">{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h2><p className="mt-2 text-sm text-[#748078]">{mode === 'login' ? 'Enter your details to continue.' : 'Start a secure document workspace.'}</p></div>
        <form action={(form) => void submit(form)} className="space-y-4">
          {mode === 'register' && <label className="block text-sm font-medium">Full name<Input name="name" placeholder="e.g. Alex Morgan" required maxLength={80} className="mt-2" /></label>}
          <label className="block text-sm font-medium">Work email<Input name="email" type="email" autoComplete="email" placeholder="you@company.com" required className="mt-2" /></label>
          <label className="block text-sm font-medium">Password<Input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 10 characters" required minLength={mode === 'register' ? 10 : 1} className="mt-2" /></label>
          {mode === 'register' && <label className="block text-sm font-medium">Workspace role<select name="role" className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-moss"><option value="sender">Sender</option><option value="recipient">Recipient</option><option value="investigator">Investigator</option></select></label>}
          {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}
          <Button type="submit" disabled={busy} className="mt-2 w-full">{busy ? <LoaderCircle size={16} className="animate-spin" /> : null}{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-[#748078]">{mode === 'login' ? 'New to ArcTrace?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="font-medium text-moss hover:underline">{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
        <p className="mt-10 text-center text-[11px] leading-5 text-[#929c95]">By continuing, you agree to use this demo for non-sensitive files only. This testnet workspace is intended for manual evaluation.</p>
      </div>
    </section>
  </div>;
}

function Overview({ greeting, user, docs, onNavigate, ledger }: { greeting: string; user: SessionUser; docs: Doc[]; onNavigate: (s: Section) => void; ledger: Ledger | null }) {
  return <>
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="text-sm text-[#748078]">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Good to see you, {greeting}</h1><p className="mt-2 text-sm text-[#748078]">Here’s what’s happening in your secure workspace.</p></div><Button onClick={() => onNavigate('documents')}><Plus size={16} />Share a document</Button></div>
    {!user.hasKeys && <Card className="mt-7 flex flex-col gap-4 border-[#d6e4d5] bg-[#f2f7f0] p-5 sm:flex-row sm:items-center"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-moss"><KeyRound size={19} /></div><div className="flex-1"><div className="text-sm font-semibold">Secure your account with a personal key</div><p className="mt-1 text-sm text-[#68776c]">Generate your encryption and signing keys in this browser before sharing or opening documents.</p></div><Button variant="outline" onClick={() => onNavigate('settings')}>Set up keys <ArrowUpRight size={15} /></Button></Card>}
    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Documents shared" value={docs.length} icon={FileText} caption="Ready to access" /><Stat label="Documents received" value="—" icon={LockKeyhole} caption="Shared with you" /><Stat label="Verified opens" value="—" icon={ShieldCheck} caption="Recorded on ledger" /><Stat label="Investigations" value="—" icon={FileSearch} caption="Leak traces" /></div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.5fr_1fr]"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Recent documents</h2><p className="mt-1 text-xs text-[#89938c]">Latest activity in your workspace</p></div><button onClick={() => onNavigate('documents')} className="text-xs font-medium text-moss hover:underline">View all</button></div>{docs.length ? <div>{docs.slice(0, 5).map((d) => <DocumentRow key={d.id} doc={d} />)}</div> : <div className="grid min-h-[190px] place-items-center px-5 text-center"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-paper text-[#829087]"><FileText size={20} /></div><div className="mt-3 text-sm font-medium">Nothing shared yet</div><p className="mt-1 text-xs text-[#89938c]">Start by adding a document to your workspace.</p><Button variant="outline" size="sm" className="mt-4" onClick={() => onNavigate('documents')}><Plus size={14} />Share a document</Button></div></div>}</Card>
      <Card className="p-5"><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-moss" /><h2 className="text-sm font-semibold">Trust & security</h2></div><div className="mt-5 space-y-4"><StatusLine label="Post-quantum keys" ok={user.hasKeys} detail={user.hasKeys ? 'Registered for this account' : 'Key setup recommended'} /><StatusLine label="Audit ledger" ok={ledger?.ok ?? false} detail={ledger?.ok ? `${ledger.mode} · ${ledger.latencyMs} ms` : 'Status unavailable'} /><StatusLine label="Private key storage" ok={user.hasKeys} detail={user.hasKeys ? 'Encrypted in this browser' : 'Not configured'} /></div><button onClick={() => onNavigate('settings')} className="mt-5 flex w-full items-center justify-between border-t border-line pt-4 text-xs font-medium text-moss">Review security settings <ArrowUpRight size={14} /></button></Card>
    </div>
  </>;
}

function Stat({ label, value, icon: Icon, caption }: { label: string; value: string | number; icon: typeof FileText; caption: string }) {
  return <Card className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-[#748078]">{label}</span><Icon size={16} className="text-[#88968d]" /></div><div className="mt-3 text-[26px] font-semibold tracking-[-.04em]">{value}</div><div className="mt-1 text-[11px] text-[#929c95]">{caption}</div></Card>;
}

function StatusLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <div className="flex items-start gap-3"><div className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full ${ok ? 'bg-[#e7f2e8] text-[#51805d]' : 'bg-[#f3f2ed] text-[#9b8b63]'}`}>{ok ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</div><div><div className="text-xs font-medium">{label}</div><div className="mt-1 text-[11px] text-[#89938c]">{detail}</div></div></div>;
}

function DocumentRow({ doc }: { doc: Doc }) {
  return <div className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0"><div className="grid h-9 w-9 place-items-center rounded-lg bg-paper text-[#78867d]"><FileText size={17} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{doc.title || 'Encrypted document'}</div><div className="mt-1 text-xs text-[#89938c]">{doc.senderName ? `From ${doc.senderName}` : 'Shared by you'} · {new Date(doc.createdAt).toLocaleDateString()}</div></div><Badge tone={doc.status === 'ready' ? 'green' : 'amber'}>{doc.status}</Badge></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-moss">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">{title}</h1><p className="mt-2 text-sm text-[#748078]">{description}</p></div>{action}</div>;
}

function DocumentList({ docs, onNew }: { docs: Doc[]; onNew: () => void }) {
  return <><PageHeading eyebrow="Workspace" title="Shared documents" description="Documents you have shared with your organisation." action={<Button onClick={onNew}><Plus size={16} />Share document</Button>} /><Card className="mt-7 overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div className="text-sm font-semibold">All documents <span className="ml-1 text-xs font-normal text-[#89938c]">{docs.length}</span></div><div className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-[#89938c]"><Search size={13} /><span>Filter</span></div></div>{docs.length ? docs.map((doc) => <DocumentRow key={doc.id} doc={doc} />) : <div className="py-16 text-center"><FileLock2 className="mx-auto text-[#9ba69e]" size={25} /><div className="mt-3 text-sm font-medium">No documents yet</div><p className="mt-1 text-xs text-[#89938c]">Create a secure share to get started.</p><Button className="mt-4" onClick={onNew}><Plus size={15} />Share a document</Button></div>}</Card></>;
}

function Inbox({ docs, onOpen }: { docs: Doc[]; onOpen: (doc: Doc) => void }) {
  return <><PageHeading eyebrow="For you" title="Your inbox" description="Documents shared with you by your organisation." /><Card className="mt-7 overflow-hidden">{docs.length ? docs.map((doc) => <div key={doc.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0"><div className="grid h-9 w-9 place-items-center rounded-lg bg-paper text-[#78867d]"><FileText size={17} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{doc.title || 'Encrypted document'}</div><div className="mt-1 text-xs text-[#89938c]">From {doc.senderName} · {new Date(doc.createdAt).toLocaleDateString()}</div></div><Badge tone="green">Ready</Badge><Button size="sm" onClick={() => onOpen(doc)}><LockKeyhole size={14} />Open</Button></div>) : <div className="py-16 text-center"><LockKeyhole className="mx-auto text-[#9ba69e]" size={25} /><div className="mt-3 text-sm font-medium">Your inbox is clear</div><p className="mt-1 text-xs text-[#89938c]">When someone shares a document with you, it will appear here.</p></div>}</Card></>;
}

function OpenDialog({ doc, user, explorerUrl, onClose }: { doc: Doc; user: SessionUser; explorerUrl?: string; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<{ url: string; name: string; entityKey: string; gateMode: string } | null>(null);
  const [text, setText] = useState('');
  useEffect(() => () => { if (opened?.url) URL.revokeObjectURL(opened.url); }, [opened?.url]);
  const open = async () => {
    setBusy(true); setError('');
    try {
      const { commitAndOpen } = await import('../lib/open');
      const result = await commitAndOpen(doc.id, user, passphrase);
      setPassphrase('');
      setOpened(result);
      if (result.name.toLowerCase().endsWith('.txt')) setText(await (await fetch(result.url)).text());
    } catch (e) { setError(e instanceof Error ? e.message : 'Document could not be opened'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="open-title"><Card className="my-6 w-full max-w-[720px] overflow-hidden"><div className="flex items-start justify-between border-b border-line p-5"><div><h2 id="open-title" className="text-lg font-semibold">{opened ? opened.name : 'Open encrypted document'}</h2><p className="mt-1 text-xs text-[#89938c]">{opened ? 'Commit recorded before the file was decrypted.' : `Shared by ${doc.senderName}`}</p></div><button aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-[#89938c] hover:bg-paper"><X size={17} /></button></div>{opened ? <div className="p-5"><div className="mb-4 flex items-center justify-between rounded-lg bg-[#eff6ef] px-3 py-2 text-xs text-[#476c50]"><span className="flex items-center gap-2"><Check size={14} />Open committed · gate {opened.gateMode}</span>{explorerUrl ? <a href={`${explorerUrl.replace(/\/$/, '')}/entity/${opened.entityKey}`} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2">View Arkiv record <ArrowUpRight size={12} className="inline" /></a> : <span className="font-mono">{opened.entityKey.slice(0, 18)}…</span>}</div>{opened.name.toLowerCase().endsWith('.txt') ? <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[#fafbf8] p-5 text-sm leading-6">{text}</pre> : opened.name.toLowerCase().endsWith('.pdf') ? <iframe title={opened.name} src={opened.url} className="h-[65vh] w-full rounded-lg border border-line" /> : <div className="max-h-[65vh] overflow-auto rounded-lg bg-[#fafbf8] p-3 text-center"><img src={opened.url} alt={opened.name} className="mx-auto max-h-[60vh] max-w-full object-contain" /></div>}<a href={opened.url} download={opened.name} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-moss hover:underline"><ArrowDownToLine size={15} />Download watermarked copy</a></div> : <div className="p-5"><div className="rounded-lg border border-[#d9e7db] bg-[#f2f7f0] p-3 text-xs leading-5 text-[#526c57]">ArcTrace records and commits your signed open before releasing the document. If the ledger is unavailable, the document stays locked.</div><label className="mt-5 block text-sm font-medium">Private key passphrase<Input type="password" autoFocus value={passphrase} onChange={(e) => setPassphrase(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && passphrase) void open(); }} placeholder="Unlock your key in this browser" className="mt-2" /></label>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!passphrase || busy} onClick={() => void open()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <LockKeyhole size={15} />}Commit & open</Button></div></div>}</Card></div>;
}

function Investigate({ user, setNotice, setError }: { user: SessionUser; setNotice: (s: string) => void; setError: (s: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [traceId, setTraceId] = useState('');
  const [trace, setTrace] = useState<{ status: string; error: string | null; result: any } | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  useEffect(() => {
    if (!traceId || trace?.status === 'done' || trace?.status === 'failed') return;
    let active = true;
    const poll = () => api<{ status: string; error: string | null; result: any }>(`/traces/${traceId}`).then((next) => { if (active) setTrace(next); }).catch(() => {});
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [traceId, trace?.status]);
  const submit = async () => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = new FormData(); data.set('file', file);
      const result = await api<{ traceId: string; status: string }>('/traces', { method: 'POST', body: data });
      setTraceId(result.traceId); setTrace({ status: result.status, error: null, result: null }); setNotice('Leak uploaded. Checking for a watermark and signed ledger record…'); setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not upload file'); }
    finally { setBusy(false); }
  };
  const downloadBundle = async () => {
    if (!traceId) return;
    setBundleBusy(true);
    try {
      const [{ DOMAIN, EvidenceBundleSchema }, crypto, { zipSync, strToU8 }, { PDFDocument, StandardFonts }, { unlockPrivateKeys }] = await Promise.all([
        import('@arctrace/shared'), import('@arctrace/crypto'), import('fflate'), import('pdf-lib'), import('../lib/keys'),
      ]);
      const evidence = await api<import('@arctrace/shared').BundleResponse>(`/traces/${traceId}/bundle`);
      if (!evidence.proofs.investigatorKeyRegistration) throw new Error('Register investigator keys before signing an evidence bundle.');
      const privateKeys = await unlockPrivateKeys(user.id, window.prompt('Unlock your signing key to sign this evidence bundle') ?? '');
      try {
        const proofHashes = Object.fromEntries(Object.entries(evidence.proofs).map(([key, proof]) => [key, proof ? crypto.sha256Hex(crypto.canonicalize(proof)) : null]));
        const core = { ...evidence.core, proofHashes };
        const investigatorSig = { alg: 'ML-DSA-65' as const, sig: crypto.toBase64(crypto.sign(DOMAIN.bundle, crypto.canonicalize(core), privateKeys.sigSk)), signerKeyFp: privateKeys.sigFp };
        const signedBundle = EvidenceBundleSchema.parse({ ...core, investigatorSig });
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        let page = pdf.addPage(); let y = page.getHeight() - 54;
        page.drawText(evidence.report.title, { x: 48, y, size: 15, font }); y -= 30;
        for (const line of evidence.report.lines) {
          if (y < 50) { page = pdf.addPage(); y = page.getHeight() - 54; }
          page.drawText(`${line.label}: ${line.value}`, { x: 48, y, size: 9, font, maxWidth: page.getWidth() - 96 }); y -= 18;
        }
        const reportPdf = await pdf.save();
        const files = {
          'bundle.json': strToU8(JSON.stringify(signedBundle, null, 2)),
          'leaked.sha256': strToU8(`${String(evidence.core.leakedFileSha256 ?? '')}\n`),
          'report.pdf': new Uint8Array(reportPdf),
          'proofs/key_registration.json': strToU8(JSON.stringify(evidence.proofs.keyRegistration, null, 2)),
          'proofs/investigator_key_registration.json': strToU8(JSON.stringify(evidence.proofs.investigatorKeyRegistration, null, 2)),
          'proofs/manifest.json': strToU8(JSON.stringify(evidence.proofs.manifest, null, 2)),
          'proofs/decryption_record.json': strToU8(JSON.stringify(evidence.proofs.decryptionRecord, null, 2)),
          'VERIFY.md': strToU8(evidence.verifyMd),
        };
        const zipped = zipSync(files);
        const zipBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
        const url = URL.createObjectURL(new Blob([zipBuffer], { type: 'application/zip' }));
        const a = document.createElement('a'); a.href = url; a.download = `arctrace-evidence-${traceId}.zip`; a.click(); URL.revokeObjectURL(url);
      } finally { privateKeys.kemSk.fill(0); privateKeys.sigSk.fill(0); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Evidence download failed'); }
    finally { setBundleBusy(false); }
  };
  return <><PageHeading eyebrow="Forensics" title="Investigate a leak" description="Upload a leaked copy to check for an ArcTrace watermark and matching signed record." /><Card className="mt-7 p-6 md:p-8"><div className="mx-auto max-w-[640px]"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf3ed] text-moss"><FileSearch size={19} /></div><div><h2 className="text-sm font-semibold">Upload leaked file</h2><p className="mt-1 text-xs text-[#89938c]">PNG, JPEG, PDF or TXT · max 25 MB</p></div></div><label className="mt-6 flex min-h-[210px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#cbd5cc] bg-[#fbfcf9] px-5 text-center hover:bg-[#f6f8f3]"><input type="file" accept=".png,.jpg,.jpeg,.pdf,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><div className="grid h-11 w-11 place-items-center rounded-full bg-white text-moss shadow-sm"><Upload size={19} /></div><div className="mt-3 text-sm font-medium">{file ? file.name : 'Choose a file or drag it here'}</div><div className="mt-1 text-xs text-[#89938c]">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'We only store the uploaded evidence for analysis.'}</div><span className="mt-4 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium">Browse files</span></label><div className="mt-5 flex items-start gap-2 rounded-lg bg-paper p-3 text-xs leading-5 text-[#738078]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-moss" />The trace checks extraction confidence, trusted Arkiv writer, and recipient signature before showing a match.</div><Button disabled={!file || busy} onClick={() => void submit()} className="mt-5 w-full">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />}Start investigation</Button></div></Card>{trace && <Card className="mt-5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold">Investigation {trace.status}</div><div className="mt-1 font-mono text-xs text-[#89938c]">{traceId}</div></div>{trace.status === 'done' && trace.result?.record && <Button variant="outline" size="sm" disabled={bundleBusy} onClick={() => void downloadBundle()}>{bundleBusy ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />}Download evidence JSON</Button>}</div>{trace.status === 'pending' || trace.status === 'processing' ? <p className="mt-4 flex items-center gap-2 text-sm text-[#748078]"><LoaderCircle size={15} className="animate-spin" />Extracting watermark and verifying the ledger record…</p> : trace.status === 'failed' ? <p className="mt-4 text-sm text-red-700">{trace.error ?? 'Trace processing failed.'}</p> : trace.status === 'done' && trace.result ? <div className="mt-5 rounded-xl bg-paper p-4"><div className="text-xs uppercase tracking-wide text-[#89938c]">Result</div>{trace.result.recordVerified && trace.result.recipient ? <div className="mt-2"><div className="text-xl font-semibold">{trace.result.recipient.displayName ?? 'Recipient identified'}</div><p className="mt-1 text-sm text-[#748078]">Watermark confidence {(trace.result.extraction.confidence * 100).toFixed(1)}% · signature verified</p><div className="mt-3 break-all font-mono text-xs text-[#748078]">Arkiv entity: {trace.result.entityKey}</div></div> : <p className="mt-2 text-sm text-[#748078]">No confident verified match. ArcTrace will not guess a recipient.</p>}</div> : null}</Card>}</>;
}

function Settings({ user }: { user: SessionUser }) {
  const [passphrase, setPassphrase] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const setupKeys = async () => {
    if (passphrase.length < 10) { setMessage('Use a passphrase with at least 10 characters.'); return; }
    setWorking(true); setMessage('');
    try {
      const { createAndRegisterKeys } = await import('../lib/keys');
      await createAndRegisterKeys(user, passphrase);
      setPassphrase(''); setMessage('Keys created and registered on the ledger. Keep your passphrase safe; it cannot be reset.');
      window.location.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Key setup failed'); }
    finally { setWorking(false); }
  };
  return <><PageHeading eyebrow="Account" title="Members & keys" description="Manage your identity and cryptographic keys for this workspace." /><div className="mt-7 grid gap-5 xl:grid-cols-2"><Card className="p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-paper text-[#75847a]"><Users size={18} /></div><div><h2 className="text-sm font-semibold">Your profile</h2><p className="mt-1 text-xs text-[#89938c]">Workspace identity</p></div></div><div className="mt-5 space-y-3 border-t border-line pt-4 text-sm"><div className="flex justify-between"><span className="text-[#89938c]">Name</span><span>{user.displayName}</span></div><div className="flex justify-between"><span className="text-[#89938c]">Email</span><span>{user.email}</span></div><div className="flex justify-between"><span className="text-[#89938c]">Role</span><span className="capitalize">{user.role}</span></div></div></Card><Card className="p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf3ed] text-moss"><KeyRound size={18} /></div><div><h2 className="text-sm font-semibold">Post-quantum identity</h2><p className="mt-1 text-xs text-[#89938c]">ML-KEM-768 + ML-DSA-65</p></div><Badge tone={user.hasKeys ? 'green' : 'amber'}>{user.hasKeys ? 'Registered' : 'Not set up'}</Badge></div><p className="mt-4 text-xs leading-5 text-[#748078]">Your private keys are generated in this browser and encrypted with your passphrase before they are saved locally. Only public keys are sent to ArcTrace.</p>{!user.hasKeys && <div className="mt-4 space-y-3"><Input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Create a private key passphrase" minLength={10} /><Button onClick={() => void setupKeys()} disabled={working} className="w-full">{working ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}Generate and register keys</Button></div>}{message && <p role="status" className="mt-3 text-xs text-moss">{message}</p>}</Card></div></>;
}

function UploadDialog({ user, onClose, onCreated }: { user: SessionUser; onClose: () => void; onCreated: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [members, setMembers] = useState<{ id: string; displayName: string; role: string; hasKeys: boolean }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<typeof members>('/org/members').then(setMembers).catch((e) => setError(e.message)); }, []);
  const create = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const { shareDocument } = await import('../lib/share');
      await shareDocument(file, selected, passphrase, user);
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not share this document'); }
    finally { setBusy(false); }
  };
  const recipients = members.filter((m) => m.id !== user.id && m.hasKeys);
  return <div className="fixed inset-0 z-30 grid place-items-center bg-ink/35 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title"><Card className="w-full max-w-[520px] p-6"><div className="flex items-start justify-between"><div><h2 id="upload-title" className="text-lg font-semibold">Share a document</h2><p className="mt-1 text-sm text-[#748078]">The file is encrypted in this browser before upload.</p></div><button aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-[#89938c] hover:bg-paper"><X size={17} /></button></div><label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 hover:bg-paper"><input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><div className="grid h-9 w-9 place-items-center rounded-lg bg-paper text-moss"><Upload size={17} /></div><div className="min-w-0"><div className="truncate text-sm font-medium">{file?.name ?? 'Choose a document'}</div><div className="mt-1 text-xs text-[#89938c]">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF, image, or text · up to 100 MB'}</div></div></label><div className="mt-5"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#7e8981]">Recipients</div><div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">{recipients.length ? recipients.map((member) => <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-paper"><input type="checkbox" checked={selected.includes(member.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, member.id] : ids.filter((id) => id !== member.id))} className="accent-[#567b65]" /><span className="flex-1 text-sm">{member.displayName}</span><span className="text-xs capitalize text-[#89938c]">{member.role}</span><Badge tone="green">Key ready</Badge></label>) : <p className="px-2 py-3 text-xs leading-5 text-[#89938c]">No other workspace members have registered keys yet. Create another account and register its keys first.</p>}</div></div><label className="mt-4 block text-xs font-medium">Your private key passphrase<Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Unlock your signing key" className="mt-2" /></label>{error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!file || selected.length === 0 || !passphrase || busy} onClick={() => void create()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUpRight size={15} />}Encrypt & share</Button></div></Card></div>;
}
