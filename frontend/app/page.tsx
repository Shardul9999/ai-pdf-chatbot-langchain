'use client';

import type React from 'react';
import { useRef, useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useToast } from '@/hooks/use-toast';
import { PDFDocument, RetrieveDocumentsNodeUpdates } from '@/types/graphTypes';

const SESSION_ID_KEY = 'chatSessionId';
const THREAD_ID_KEY = 'chatThreadId';

const SUGGESTIONS = [
  { icon: '📖', text: 'What is this about?' },
  { icon: '🔬', text: 'Key findings' },
  { icon: '💡', text: 'Main concepts' },
  { icon: '📊', text: 'Summarize this doc' },
];

function ReadrIcon({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d="M3 1v16M3 1h7a4 4 0 0 1 0 8H3M9 9l5.5 8" stroke={color} strokeWidth="2.2" strokeLinecap="butt" strokeLinejoin="miter" />
      <circle cx="11" cy="5" r="1.8" fill={color} />
    </svg>
  );
}

function WaveIndicator({ accent }: { accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '20px', padding: '0 2px' }}>
      {[0, 1, 2, 3, 4, 3, 2].map((_, i) => (
        <div key={i} style={{ width: '3px', height: '100%', borderRadius: '2px', background: accent, transformOrigin: 'center', animation: `wave-bar 1s ease-in-out ${i * 0.1}s infinite` }} />
      ))}
    </div>
  );
}

type Msg = { role: 'user' | 'assistant'; content: string; sources?: PDFDocument[] };

export default function Home() {
  const { toast } = useToast();
  const { user } = useUser();
  const firstName = user?.firstName;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const msgsContainerRef = useRef<HTMLDivElement>(null);
  const lastDocsRef = useRef<PDFDocument[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragCounterRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; r: number; opacity: number }>>([]);

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const accent      = isDark ? '#FFD600' : 'oklch(0.56 0.15 195)';
  const rw          = isDark ? '255,214,0' : '13,148,136';
  const a8          = `rgba(${rw},0.08)`;
  const a15         = `rgba(${rw},0.15)`;
  const a20         = `rgba(${rw},0.20)`;
  const a25         = `rgba(${rw},0.25)`;
  const a30         = `rgba(${rw},0.30)`;
  const outerBg     = isDark ? '#000000' : '#edf6fc';
  const headerBg    = isDark ? 'rgba(0,0,0,0.96)' : 'rgba(247,252,255,0.96)';
  const borderColor = `rgba(${rw},0.16)`;
  const aiBubbleBg  = isDark ? 'rgba(12,12,12,0.95)' : 'rgba(239,247,253,0.97)';
  const chipBg      = `rgba(${rw},0.07)`;
  const chipBorder  = `rgba(${rw},0.18)`;
  const inputBg     = isDark ? 'rgba(0,0,0,0.88)' : 'rgba(237,246,252,0.86)';
  const inputBorderColor = inputFocused ? accent : `rgba(${rw},0.2)`;
  const inputGlow   = inputFocused
    ? `0 0 0 3px rgba(${rw},0.14), 0 0 22px rgba(${rw},0.1)`
    : `0 0 0 1px rgba(${rw},0.07)`;
  const textPrimary   = isDark ? '#d6e3ef' : '#0b1724';
  const textSecondary = isDark ? '#4e6070' : '#7898ae';
  const userTextColor = isDark ? '#000' : '#fff';

  // ── Particle canvas setup ─────────────────────────────────────────────────
  // Depends on isHistoryLoading: the canvas only mounts after the loading splash
  // is dismissed, so the effect must re-run when that state changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    particlesRef.current = Array.from({ length: 60 }, () => ({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 1.9 + 0.4,
      opacity: Math.random() * 0.42 + 0.1,
    }));
    const onResize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isHistoryLoading]);

  // ── Particle animation loop ───────────────────────────────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const [pr, pg, pb] = isDark ? [255, 214, 0] : [13, 148, 136];
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      particlesRef.current.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > c.width) p.vx *= -1;
        if (p.y < 0 || p.y > c.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${p.opacity})`;
        ctx.fill();
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const q = particlesRef.current[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 130) {
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${pr},${pg},${pb},${0.13 * (1 - d / 130)})`;
            ctx.lineWidth = 0.5; ctx.stroke();
          }
        }
      });
      animFrameRef.current = requestAnimationFrame(draw);
    };
    animFrameRef.current = requestAnimationFrame(draw);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isDark, isHistoryLoading]);

  // ── Session init ──────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      setIsHistoryLoading(true);
      const minDelay = new Promise(res => setTimeout(res, 2500));
      try {
        const sid = localStorage.getItem(SESSION_ID_KEY);
        const tid = localStorage.getItem(THREAD_ID_KEY);
        if (sid && tid) {
          setSessionId(sid); setThreadId(tid);
          const res = await fetch(`/api/history?sessionId=${sid}`);
          if (res.ok) {
            const { messages: rows } = await res.json();
            if (rows?.length > 0) {
              setMessages(rows.map((r: { role: 'user' | 'assistant'; content: string; sources?: any[] | null }) => ({
                role: r.role, content: r.content, sources: r.sources ?? undefined,
              })));
            }
          }
        } else {
          createNewSession();
        }
      } catch { createNewSession(); }
      await minDelay;
      setIsHistoryLoading(false);
    };
    init();
  }, []);

  // ── Scroll to bottom — directly on the container, never touches the window ─
  useEffect(() => {
    const el = msgsContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Skeleton: show briefly after splash ends if history exists ───────────
  useEffect(() => {
    if (!isHistoryLoading && messages.length > 0) {
      setShowSkeleton(true);
      const t = setTimeout(() => setShowSkeleton(false), 900);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHistoryLoading]);

  // ── Session helpers ───────────────────────────────────────────────────────
  const createNewSession = () => {
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, id);
    localStorage.setItem(THREAD_ID_KEY, id);
    setSessionId(id); setThreadId(id); setMessages([]);
  };

  const handleNewChat = () => {
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(THREAD_ID_KEY);
    setFiles([]); setInput('');
    createNewSession();
    toast({ title: 'New chat started', description: 'Started a fresh conversation.' });
  };

  // ── Send message (SSE streaming) ──────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || !threadId || !sessionId || isLoading) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();

    setMessages(prev => [...prev,
      { role: 'user', content: text, sources: undefined },
      { role: 'assistant', content: '', sources: undefined },
    ]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    lastDocsRef.current = [];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n').filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          const { event, data } = ev;

          if (event === 'messages/partial' || event === 'messages') {
            const msgs = Array.isArray(data) ? data : [data];
            const ai = msgs.filter((m: any) => m?.type === 'ai').pop();
            if (ai) {
              const content = typeof ai.content === 'string'
                ? ai.content
                : Array.isArray(ai.content)
                  ? ai.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
                  : '';
              if (content) {
                setMessages(prev => {
                  const arr = [...prev];
                  if (arr.at(-1)?.role === 'assistant')
                    arr[arr.length - 1] = { ...arr[arr.length - 1], content, sources: lastDocsRef.current };
                  return arr;
                });
              }
            }
          } else if (event === 'updates' && data) {
            if ('retrieveDocuments' in data && Array.isArray(data.retrieveDocuments?.documents)) {
              lastDocsRef.current = (data as RetrieveDocumentsNodeUpdates).retrieveDocuments.documents as PDFDocument[];
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
      setMessages(prev => {
        const arr = [...prev];
        if (arr.at(-1)?.role === 'assistant')
          arr[arr.length - 1] = { ...arr[arr.length - 1], content: 'Sorry, there was an error processing your message.' };
        return arr;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    if (selected.some(f => f.type !== 'application/pdf')) {
      toast({ title: 'PDFs only', description: 'Please upload PDF files only', variant: 'destructive' });
      return;
    }
    if (!threadId) {
      toast({ title: 'Upload failed', description: 'No active chat session yet', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      selected.forEach(f => fd.append('files', f));
      fd.append('threadId', threadId);
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Upload failed'); }
      setFiles(prev => [...prev, ...selected]);
      toast({ title: 'Uploaded', description: `${selected.length} file${selected.length > 1 ? 's' : ''} ready` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDropFiles = async (fileList: FileList) => {
    const selected = Array.from(fileList).filter(f => f.type === 'application/pdf');
    if (!selected.length) {
      toast({ title: 'PDFs only', description: 'Please drop PDF files only', variant: 'destructive' });
      return;
    }
    if (!threadId) {
      toast({ title: 'Upload failed', description: 'No active chat session yet', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      selected.forEach(f => fd.append('files', f));
      fd.append('threadId', threadId);
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Upload failed'); }
      setFiles(prev => [...prev, ...selected]);
      toast({ title: 'Uploaded', description: `${selected.length} file${selected.length > 1 ? 's' : ''} ready` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const isEmpty = messages.length === 0 && !isLoading;

  // ── Loading splash ────────────────────────────────────────────────────────
  if (isHistoryLoading) {
    return (
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        <div className="loader">
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="text"><span>Loading</span></div>
          <div className="line"></div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  // html + body have `height: 100%; overflow: hidden` (globals.css) — window never scrolls.
  // This fixed+inset-0 container owns the full viewport; only msgsContainerRef scrolls.
  return (
    <div
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', background: outerBg, transition: 'background 0.5s ease', overflow: 'hidden' }}
      onDragEnter={e => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true); }}
      onDragLeave={e => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false); }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); dragCounterRef.current = 0; setIsDragging(false); handleDropFiles(e.dataTransfer.files); }}
    >

      {/* Drag-drop overlay */}
      {isDragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px', border: `2px dashed ${accent}`, pointerEvents: 'none', animation: 'msg-in 0.18s ease' }}>
          <div style={{ width: '88px', height: '88px', border: `2px dashed ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'drag-float 1s ease-in-out infinite' }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
              <path d="M12 15V3M12 3L7 8M12 3l5 5" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke={accent} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: accent, letterSpacing: '-0.5px' }}>Drop your PDF here</div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1px' }}>Release to upload</div>
        </div>
      )}

      {/* Ambient blobs — position:absolute, out of flex flow */}
      <div style={{ position: 'absolute', top: '-10%', left: '-8%', width: '50vw', height: '50vw', background: 'radial-gradient(ellipse, rgba(255,214,0,0.07) 0%, transparent 62%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '-8%', width: '46vw', height: '46vw', background: 'radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 62%)', pointerEvents: 'none', zIndex: 0 }} />

      {/* Particle canvas — position:absolute, out of flex flow */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, opacity: isDark ? 1 : 0.5 }} />

      {/* ── HEADER — flex-shrink:0, always visible, never scrolls away ── */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 28px', borderBottom: `1px solid ${borderColor}`, background: headerBg, backdropFilter: 'blur(20px)', flexShrink: 0 }}>
        <div style={{ width: '36px', height: '36px', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 14px ${a25}` }}>
          <ReadrIcon color={userTextColor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: textPrimary, letterSpacing: '-0.4px', lineHeight: 1.2 }}>Readr</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', animation: 'status-pulse 2.4s ease infinite' }} />
            <span style={{ fontSize: '11px', color: textSecondary, fontWeight: 500 }}>AI Research Assistant · Ready</span>
          </div>
        </div>
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '280px' }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: chipBg, border: `1px solid ${chipBorder}`, fontSize: '11px', color: textSecondary }}>
                <span>📄</span>
                <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: textSecondary, cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '14px' }}>×</button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={handleNewChat}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: '50px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500, color: textSecondary, transition: 'all 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = accent; (e.currentTarget as HTMLElement).style.borderColor = accent; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = textSecondary; (e.currentTarget as HTMLElement).style.borderColor = chipBorder; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M5 1v8M1 5h8" /></svg>
          New chat
        </button>
        <button
          onClick={() => setIsDark(d => !d)}
          style={{ width: '36px', height: '36px', background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: textSecondary, transition: 'all 0.2s', flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = accent; (e.currentTarget as HTMLElement).style.borderColor = accent; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = textSecondary; (e.currentTarget as HTMLElement).style.borderColor = chipBorder; }}
        >
          {isDark
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          }
        </button>
      </div>

      {/* ── MESSAGES — flex:1 + minHeight:0 = fills all space between header and footer.
           ref on THIS div so scrollTo() targets the container, never the window. ── */}
      <div
        ref={msgsContainerRef}
        style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '32px 24px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'stretch' }}
      >
        <div style={{ width: '100%', maxWidth: '740px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>

          {isEmpty && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '12vh 20px 20px', gap: '22px' }}>
              <div style={{ width: '80px', height: '80px', background: chipBg, border: `1px solid ${chipBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 40px ${a15}` }}>
                <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
                  <path d="M6 2v32M6 2h14a8 8 0 0 1 0 16H6M18 18l11 16" stroke={accent} strokeWidth="4" strokeLinecap="butt" strokeLinejoin="miter" />
                  <circle cx="22" cy="10" r="3.5" fill={accent} />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: textPrimary, letterSpacing: '-0.6px', marginBottom: '10px' }}>
                  {firstName ? `What would you like to explore, ${firstName}?` : 'What would you like to explore?'}
                </div>
                <div style={{ fontSize: '15px', color: textSecondary, lineHeight: 1.7, maxWidth: '380px', margin: '0 auto' }}>Ask anything about your document — summaries, concepts, deep analysis.</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', maxWidth: '520px', marginTop: '6px' }}>
                {SUGGESTIONS.map(s => (
                  <button key={s.text} onClick={() => sendMessage(s.text)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 18px', background: chipBg, border: `1px solid ${chipBorder}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 500, color: textPrimary, transition: 'all 0.2s', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = accent; el.style.color = accent; el.style.background = a8; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = chipBorder; el.style.color = textPrimary; el.style.background = chipBg; }}
                  >
                    <span>{s.icon}</span><span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSkeleton && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', animation: 'msg-in 0.3s ease' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div className="skeleton-bone" style={{ width: '34px', height: '34px', flexShrink: 0 }} />
                <div style={{ flex: 1, maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="skeleton-bone" style={{ height: '14px', width: '82%' }} />
                  <div className="skeleton-bone" style={{ height: '14px', width: '66%' }} />
                  <div className="skeleton-bone" style={{ height: '14px', width: '50%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div className="skeleton-bone" style={{ height: '46px', width: '40%', borderRadius: '2px' }} />
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div className="skeleton-bone" style={{ width: '34px', height: '34px', flexShrink: 0 }} />
                <div style={{ flex: 1, maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="skeleton-bone" style={{ height: '14px', width: '90%' }} />
                  <div className="skeleton-bone" style={{ height: '14px', width: '72%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div className="skeleton-bone" style={{ height: '46px', width: '55%', borderRadius: '2px' }} />
              </div>
            </div>
          )}

          {!showSkeleton && messages.map((msg, i) => (
            <div key={i} style={{ animation: 'msg-in 0.3s ease' }}>
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '62%', background: accent, color: userTextColor, padding: '13px 18px', fontSize: '15px', lineHeight: 1.65, boxShadow: `0 4px 20px ${a25}`, fontWeight: 450, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {msg.content}
                  </div>
                </div>
              )}
              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{ width: '34px', height: '34px', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 14px ${a20}`, marginTop: '2px' }}>
                    <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                      <path d="M2 1v12M2 1h5a3 3 0 0 1 0 6H2M6 7l4 6" stroke={userTextColor} strokeWidth="1.8" strokeLinecap="butt" strokeLinejoin="miter" />
                      <circle cx="7.5" cy="4" r="1.2" fill={userTextColor} />
                    </svg>
                  </div>
                  <div style={{ maxWidth: '74%', minWidth: 0 }}>
                    {msg.content === '' && isLoading && i === messages.length - 1 ? (
                      <div style={{ background: aiBubbleBg, padding: '16px 18px', border: `1px solid ${chipBorder}`, display: 'flex', alignItems: 'center', minWidth: '80px', backdropFilter: 'blur(12px)' }}>
                        <WaveIndicator accent={accent} />
                      </div>
                    ) : (
                      <>
                        <div style={{ background: aiBubbleBg, color: textPrimary, padding: '13px 18px', fontSize: '15px', lineHeight: 1.7, border: `1px solid ${chipBorder}`, backdropFilter: 'blur(12px)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.content}
                        </div>
                        {msg.sources && msg.sources.length > 0 && (
                          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {msg.sources.slice(0, 5).map((src, si) => {
                              const rawName = src.metadata?.source || src.metadata?.filename || 'Source';
                              const fileName = rawName.split(/[/\\]/).pop() || rawName;
                              return (
                              <div key={si} style={{ padding: '4px 10px', background: chipBg, border: `1px solid ${chipBorder}`, fontSize: '11px', color: textSecondary }}>
                                📄 {fileName}
                                {src.metadata?.loc?.pageNumber ? ` · p.${src.metadata.loc.pageNumber}` : ''}
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── FOOTER — flex-shrink:0, pinned at the very bottom, never scrolls ── */}
      <div style={{ position: 'relative', zIndex: 2, padding: '12px 24px 18px', borderTop: `1px solid ${borderColor}`, background: headerBg, backdropFilter: 'blur(20px)', flexShrink: 0 }}>
        <div style={{ maxWidth: '740px', margin: '0 auto' }}>
          <form onSubmit={e => { e.preventDefault(); sendMessage(input); }}>
            <div className="chat-input-wrap" style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', background: inputBg, border: `1px solid ${inputBorderColor}`, padding: '10px 16px', transition: 'box-shadow 0.3s ease, border-color 0.3s ease', boxShadow: inputGlow }}>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf" multiple style={{ display: 'none' }} />
              <button
                type="button"
                className="plus-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title={isUploading ? 'Uploading…' : 'Upload PDF'}
                style={{
                  background: accent,
                  border: 'none',
                  color: userTextColor,
                  opacity: isUploading ? 0.5 : 1,
                  boxShadow: `0 0 14px ${a25}`,
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style={{ animation: isUploading ? 'spin 0.8s linear infinite' : 'none' }}>
                  <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7-7v14" />
                </svg>
              </button>
              <textarea
                ref={textareaRef}
                className="chat-input-field"
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask Readr anything…"
                rows={1}
                disabled={isLoading || !threadId}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: textPrimary, fontSize: '15px', lineHeight: 1.55, fontFamily: 'inherit', maxHeight: '120px', overflowY: 'auto', padding: '4px 0', caretColor: accent, resize: 'none' }}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() || isLoading || !threadId}
                style={{ background: accent, color: userTextColor, border: 'none', boxShadow: `0 0 14px ${a25}`, opacity: input.trim() && !isLoading ? 1 : 0.82 }}
              >
                <div className="svg-wrapper-1">
                  <div className="svg-wrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                      <path fill="none" d="M0 0h24v24H0z" />
                      <path fill="currentColor" d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z" />
                    </svg>
                  </div>
                </div>
                <span>Send</span>
              </button>
            </div>
          </form>
          <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '11px', color: textSecondary, opacity: 0.4, letterSpacing: '0.15px' }}>
            Powered by LangChain · Readr for researchers &amp; students
          </div>
        </div>
      </div>
    </div>
  );
}
