'use client';

import type React from 'react';
import { useRef, useState, useEffect } from 'react';
import { useUser, UserButton } from '@clerk/nextjs';
import { readChatEvents } from '@/lib/sse';
import { uploadError } from '@/lib/upload-limits';
import { useToast } from '@/hooks/use-toast';
import { PDFDocument, RetrieveDocumentsNodeUpdates } from '@/types/graphTypes';

const sessionKey = (userId: string) => `readr:session:${userId}`;

const SUGGESTIONS = [
  { icon: '📖', text: 'What is this about?' },
  { icon: '🔬', text: 'Key findings' },
  { icon: '💡', text: 'Main concepts' },
  { icon: '📊', text: 'Summarize this doc' },
];

function ReadrIcon({
  size = 18,
  color = '#000',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M3 1v16M3 1h7a4 4 0 0 1 0 8H3M9 9l5.5 8"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <circle cx="11" cy="5" r="1.8" fill={color} />
    </svg>
  );
}

function WaveIndicator({ accent }: { accent: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        height: '20px',
        padding: '0 2px',
      }}
    >
      {[0, 1, 2, 3, 4, 3, 2].map((_, i) => (
        <div
          key={i}
          style={{
            width: '3px',
            height: '100%',
            borderRadius: '2px',
            background: accent,
            transformOrigin: 'center',
            animation: `wave-bar 1s ease-in-out ${i * 0.1}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  sources?: PDFDocument[];
};

export default function Home() {
  const { toast } = useToast();
  const { user, isLoaded } = useUser();
  const userId = user?.id;
  const activeThreadRef = useRef<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const firstName = user?.firstName;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [docs, setDocs] = useState<{ filename: string; chunkCount: number }[]>(
    [],
  );
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
  const particlesRef = useRef<
    Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      opacity: number;
    }>
  >([]);

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const accent = isDark ? '#FFD600' : 'oklch(0.56 0.15 195)';
  const rw = isDark ? '255,214,0' : '13,148,136';
  const a8 = `rgba(${rw},0.08)`;
  const a15 = `rgba(${rw},0.15)`;
  const a20 = `rgba(${rw},0.20)`;
  const a25 = `rgba(${rw},0.25)`;
  const outerBg = isDark ? '#000000' : '#edf6fc';
  const headerBg = isDark ? 'rgba(0,0,0,0.96)' : 'rgba(247,252,255,0.96)';
  const borderColor = `rgba(${rw},0.16)`;
  const aiBubbleBg = isDark ? 'rgba(12,12,12,0.95)' : 'rgba(239,247,253,0.97)';
  const chipBg = `rgba(${rw},0.07)`;
  const chipBorder = `rgba(${rw},0.18)`;
  const inputBg = isDark ? 'rgba(0,0,0,0.88)' : 'rgba(237,246,252,0.86)';
  const inputBorderColor = inputFocused ? accent : `rgba(${rw},0.2)`;
  const inputGlow = inputFocused
    ? `0 0 0 3px rgba(${rw},0.14), 0 0 22px rgba(${rw},0.1)`
    : `0 0 0 1px rgba(${rw},0.07)`;
  const textPrimary = isDark ? '#d6e3ef' : '#0b1724';
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
    const onResize = () => {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isHistoryLoading]);

  // ── Particle animation loop ───────────────────────────────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const [pr, pg, pb] = isDark ? [255, 214, 0] : [13, 148, 136];
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      particlesRef.current.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > c.width) p.vx *= -1;
        if (p.y < 0 || p.y > c.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${p.opacity})`;
        ctx.fill();
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const q = particlesRef.current[j];
          const dx = p.x - q.x,
            dy = p.y - q.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 130) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${pr},${pg},${pb},${0.13 * (1 - d / 130)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });
      animFrameRef.current = requestAnimationFrame(draw);
    };
    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isDark, isHistoryLoading]);

  // Restore only the signed-in user's session; abort work on account changes.
  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    activeThreadRef.current = null;
    setMessages([]);
    setDocs([]);
    setSessionId(null);
    setThreadId(null);
    setIsLoading(false);
    setHistoryCursor(null);
    if (!userId) {
      setIsHistoryLoading(false);
      return;
    }
    const init = async () => {
      setIsHistoryLoading(true);
      try {
        let id: string | null = null;
        try {
          id = localStorage.getItem(sessionKey(userId));
          // Preserve the prior release's conversation pointer. The server still
          // checks ownership, so another account's messages cannot be loaded.
          if (!id) id = localStorage.getItem('chatSessionId');
        } catch {
          /* Private browsing may disable storage. */
        }
        if (!id || !/^[\w-]{1,128}$/.test(id)) id = crypto.randomUUID();
        try {
          localStorage.setItem(sessionKey(userId), id);
        } catch {
          /* Session still works in memory. */
        }
        activeThreadRef.current = id;
        setSessionId(id);
        setThreadId(id);
        const res = await fetch(
          `/api/history?sessionId=${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (!res.ok)
          throw new Error(
            'Could not load saved messages. Please refresh to retry.',
          );
        const result = await res.json();
        if (!controller.signal.aborted) {
          setMessages(result.messages ?? []);
          setHistoryCursor(result.nextCursor);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            title: 'History unavailable',
            description:
              error instanceof Error
                ? error.message
                : 'Please refresh to retry.',
            variant: 'destructive',
          });
      } finally {
        if (!controller.signal.aborted) setIsHistoryLoading(false);
      }
    };
    void init();
    return () => {
      controller.abort();
      abortControllerRef.current?.abort();
      activeThreadRef.current = null;
    };
  }, [isLoaded, userId, toast]);

  const loadOlderMessages = async () => {
    if (!historyCursor || !sessionId || loadingOlder) return;
    const id = sessionId;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/history?sessionId=${encodeURIComponent(id)}&before=${encodeURIComponent(historyCursor)}`,
      );
      if (!res.ok) throw new Error('Could not load earlier messages.');
      const result = await res.json();
      if (activeThreadRef.current === id) {
        setMessages((current) => [...result.messages, ...current]);
        setHistoryCursor(result.nextCursor);
      }
    } catch {
      toast({
        title: 'History unavailable',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoadingOlder(false);
    }
  };

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
  }, [isHistoryLoading]);

  // ── Document list: reload whenever the active thread changes ─────────────
  useEffect(() => {
    if (threadId) refreshDocuments(threadId);
    else setDocs([]);
  }, [threadId]);

  // ── Session helpers ───────────────────────────────────────────────────────
  const createNewSession = () => {
    const id = crypto.randomUUID();
    if (userId) {
      try {
        localStorage.setItem(sessionKey(userId), id);
      } catch {
        /* Storage is optional. */
      }
    }
    activeThreadRef.current = id;
    setHistoryCursor(null);
    setSessionId(id);
    setThreadId(id);
    setMessages([]);
    setDocs([]);
  };

  // ── Document management ───────────────────────────────────────────────────
  const refreshDocuments = async (tid: string) => {
    try {
      const res = await fetch(`/api/documents?threadId=${tid}`);
      if (!res.ok) throw new Error('Documents unavailable');
      const { documents } = await res.json();
      if (activeThreadRef.current === tid)
        setDocs(Array.isArray(documents) ? documents : []);
    } catch {
      if (activeThreadRef.current === tid)
        toast({
          title: 'Documents unavailable',
          description: 'Please refresh to retry.',
          variant: 'destructive',
        });
    }
  };

  const handleDeleteDocument = async (filename: string) => {
    if (!threadId || isLoading || isUploading) return;
    const deletingThread = threadId;
    try {
      const res = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, filename }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Delete failed');
      }
      if (activeThreadRef.current !== deletingThread) return;
      setDocs((prev) => prev.filter((d) => d.filename !== filename));
      toast({ title: 'Deleted', description: `${filename} removed` });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDownloadDocument = async (filename: string) => {
    if (!threadId) return;
    try {
      const res = await fetch(
        `/api/documents/download?threadId=${threadId}&filename=${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.replace(/\.pdf$/i, '') + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleNewChat = () => {
    if (isUploading) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setInput('');
    createNewSession();
    toast({
      title: 'New chat started',
      description: 'Started a fresh conversation.',
    });
  };

  // ── Send message (SSE streaming) ──────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || !threadId || !sessionId || isLoading || isUploading)
      return;
    if (abortControllerRef.current) abortControllerRef.current.abort();

    setMessages((prev) => [
      ...prev,
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
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || 'Unable to send message');
      }

      if (!res.body) throw new Error('Empty response');
      let completed = false;
      for await (const ev of readChatEvents(res.body)) {
        if (ctrl.signal.aborted || activeThreadRef.current !== threadId) return;
        const { event, data } = ev;
        if (event === 'error')
          throw new Error(
            (data as { message?: string })?.message || 'Response failed',
          );
        if (event === 'messages') completed = true;
        if (event === 'messages/partial' || event === 'messages') {
          const msgs = Array.isArray(data) ? data : [data];
          const ai = msgs
            .filter(
              (m): m is { type: 'ai'; content: string } =>
                !!m &&
                typeof m === 'object' &&
                'type' in m &&
                m.type === 'ai' &&
                'content' in m &&
                typeof m.content === 'string',
            )
            .pop();
          if (ai) {
            const content = ai.content;
            if (content) {
              setMessages((prev) => {
                const arr = [...prev];
                if (arr.at(-1)?.role === 'assistant')
                  arr[arr.length - 1] = {
                    ...arr[arr.length - 1],
                    content,
                    sources: lastDocsRef.current,
                  };
                return arr;
              });
            }
          }
        } else if (event === 'updates' && data && typeof data === 'object') {
          if (
            'retrieveDocuments' in data &&
            Array.isArray(
              (data as RetrieveDocumentsNodeUpdates).retrieveDocuments
                ?.documents,
            )
          ) {
            lastDocsRef.current = (data as RetrieveDocumentsNodeUpdates)
              .retrieveDocuments.documents as PDFDocument[];
          }
        }
      }
      if (!completed)
        throw new Error(
          'The connection ended before the response was saved. Please try again.',
        );
    } catch (err) {
      if (ctrl.signal.aborted || activeThreadRef.current !== threadId) return;
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      setMessages((prev) => {
        const arr = [...prev];
        if (arr.at(-1)?.role === 'assistant')
          arr[arr.length - 1] = {
            ...arr[arr.length - 1],
            content: 'Sorry, there was an error processing your message.',
          };
        return arr;
      });
    } finally {
      if (abortControllerRef.current === ctrl) {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  // Shared validation for picker and drag-and-drop uploads.
  const uploadFiles = async (selected: File[]) => {
    if (isUploading || isLoading || !threadId) return;
    const validation = uploadError(selected);
    if (validation) {
      toast({
        title: 'Upload failed',
        description: validation,
        variant: 'destructive',
      });
      return;
    }
    const uploadingThread = threadId;
    setIsUploading(true);
    try {
      const fd = new FormData();
      selected.forEach((file) => fd.append('files', file));
      fd.append('threadId', uploadingThread);
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Upload failed');
      if (activeThreadRef.current !== uploadingThread) return;
      await refreshDocuments(uploadingThread);
      toast({
        title: 'Uploaded',
        description: `${result.filesIngested} file(s) ready`,
      });
    } catch (error) {
      if (activeThreadRef.current === uploadingThread)
        toast({
          title: 'Upload failed',
          description:
            error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) =>
    uploadFiles(Array.from(e.target.files ?? []));
  const handleDropFiles = (files: FileList) => uploadFiles(Array.from(files));

  const isEmpty = messages.length === 0 && !isLoading;

  // ── Loading splash ────────────────────────────────────────────────────────
  if (isHistoryLoading) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
        }}
      >
        <div className="loader">
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
          <div className="text">
            <span>Loading</span>
          </div>
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
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        flexDirection: 'column',
        background: outerBg,
        transition: 'background 0.5s ease',
        overflow: 'hidden',
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current++;
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        handleDropFiles(e.dataTransfer.files);
      }}
    >
      {/* Drag-drop overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            border: `2px dashed ${accent}`,
            pointerEvents: 'none',
            animation: 'msg-in 0.18s ease',
          }}
        >
          <div
            style={{
              width: '88px',
              height: '88px',
              border: `2px dashed ${accent}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'drag-float 1s ease-in-out infinite',
            }}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 15V3M12 3L7 8M12 3l5 5"
                stroke={accent}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"
                stroke={accent}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: accent,
              letterSpacing: '-0.5px',
            }}
          >
            Drop your PDF here
          </div>
          <div
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.45)',
              letterSpacing: '0.1px',
            }}
          >
            Release to upload
          </div>
        </div>
      )}

      {/* Ambient blobs — position:absolute, out of flex flow */}
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          left: '-8%',
          width: '50vw',
          height: '50vw',
          background:
            'radial-gradient(ellipse, rgba(255,214,0,0.07) 0%, transparent 62%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          right: '-8%',
          width: '46vw',
          height: '46vw',
          background:
            'radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 62%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Particle canvas — position:absolute, out of flex flow */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 1,
          opacity: isDark ? 1 : 0.5,
        }}
      />

      {/* ── HEADER — flex-shrink:0, always visible, never scrolls away ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 28px',
          borderBottom: `1px solid ${borderColor}`,
          background: headerBg,
          backdropFilter: 'blur(20px)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            background: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: `0 0 14px ${a25}`,
          }}
        >
          <ReadrIcon color={userTextColor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: textPrimary,
              letterSpacing: '-0.4px',
              lineHeight: 1.2,
            }}
          >
            Readr
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              marginTop: '2px',
            }}
          >
            <div
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#22c55e',
                animation: 'status-pulse 2.4s ease infinite',
              }}
            />
            <span
              style={{
                fontSize: '11px',
                color: textSecondary,
                fontWeight: 500,
              }}
            >
              AI Research Assistant · Ready
            </span>
          </div>
        </div>
        {docs.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              maxWidth: '360px',
            }}
          >
            {docs.map((d) => (
              <div
                key={d.filename}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  background: chipBg,
                  border: `1px solid ${chipBorder}`,
                  fontSize: '11px',
                  color: textSecondary,
                }}
              >
                <span>📄</span>
                <span
                  title={`${d.filename} · ${d.chunkCount} chunk${d.chunkCount === 1 ? '' : 's'}`}
                  style={{
                    maxWidth: '110px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.filename}
                </span>
                <button
                  onClick={() => handleDownloadDocument(d.filename)}
                  title="Download extracted text"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: textSecondary,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: '12px',
                  }}
                >
                  ⬇
                </button>
                <button
                  onClick={() => handleDeleteDocument(d.filename)}
                  title="Delete document"
                  disabled={isLoading || isUploading}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: textSecondary,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: '14px',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <UserButton />
        <button
          onClick={handleNewChat}
          disabled={isUploading || isLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '7px 14px',
            background: chipBg,
            border: `1px solid ${chipBorder}`,
            borderRadius: '50px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '12px',
            fontWeight: 500,
            color: textSecondary,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = accent;
            (e.currentTarget as HTMLElement).style.borderColor = accent;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = textSecondary;
            (e.currentTarget as HTMLElement).style.borderColor = chipBorder;
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M5 1v8M1 5h8" />
          </svg>
          New chat
        </button>
        <button
          onClick={() => setIsDark((d) => !d)}
          style={{
            width: '36px',
            height: '36px',
            background: chipBg,
            border: `1px solid ${chipBorder}`,
            borderRadius: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: textSecondary,
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = accent;
            (e.currentTarget as HTMLElement).style.borderColor = accent;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = textSecondary;
            (e.currentTarget as HTMLElement).style.borderColor = chipBorder;
          }}
        >
          {isDark ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* ── MESSAGES — flex:1 + minHeight:0 = fills all space between header and footer.
           ref on THIS div so scrollTo() targets the container, never the window. ── */}
      <div
        ref={msgsContainerRef}
        role="log"
        aria-label="Conversation"
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '32px 24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '740px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            flex: 1,
          }}
        >
          {historyCursor && (
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingOlder}
              style={{ color: accent, padding: 12 }}
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {isEmpty && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '12vh 20px 20px',
                gap: '22px',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  background: chipBg,
                  border: `1px solid ${chipBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 0 40px ${a15}`,
                }}
              >
                <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
                  <path
                    d="M6 2v32M6 2h14a8 8 0 0 1 0 16H6M18 18l11 16"
                    stroke={accent}
                    strokeWidth="4"
                    strokeLinecap="butt"
                    strokeLinejoin="miter"
                  />
                  <circle cx="22" cy="10" r="3.5" fill={accent} />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 700,
                    color: textPrimary,
                    letterSpacing: '-0.6px',
                    marginBottom: '10px',
                  }}
                >
                  {firstName
                    ? `What would you like to explore, ${firstName}?`
                    : 'What would you like to explore?'}
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: textSecondary,
                    lineHeight: 1.7,
                    maxWidth: '380px',
                    margin: '0 auto',
                  }}
                >
                  Ask anything about your document — summaries, concepts, deep
                  analysis.
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  justifyContent: 'center',
                  maxWidth: '520px',
                  marginTop: '6px',
                }}
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => sendMessage(s.text)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '11px 18px',
                      background: chipBg,
                      border: `1px solid ${chipBorder}`,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: textPrimary,
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = accent;
                      el.style.color = accent;
                      el.style.background = a8;
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = chipBorder;
                      el.style.color = textPrimary;
                      el.style.background = chipBg;
                    }}
                  >
                    <span>{s.icon}</span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSkeleton && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                animation: 'msg-in 0.3s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  className="skeleton-bone"
                  style={{ width: '34px', height: '34px', flexShrink: 0 }}
                />
                <div
                  style={{
                    flex: 1,
                    maxWidth: '74%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div
                    className="skeleton-bone"
                    style={{ height: '14px', width: '82%' }}
                  />
                  <div
                    className="skeleton-bone"
                    style={{ height: '14px', width: '66%' }}
                  />
                  <div
                    className="skeleton-bone"
                    style={{ height: '14px', width: '50%' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  className="skeleton-bone"
                  style={{ height: '46px', width: '40%', borderRadius: '2px' }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  className="skeleton-bone"
                  style={{ width: '34px', height: '34px', flexShrink: 0 }}
                />
                <div
                  style={{
                    flex: 1,
                    maxWidth: '74%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div
                    className="skeleton-bone"
                    style={{ height: '14px', width: '90%' }}
                  />
                  <div
                    className="skeleton-bone"
                    style={{ height: '14px', width: '72%' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  className="skeleton-bone"
                  style={{ height: '46px', width: '55%', borderRadius: '2px' }}
                />
              </div>
            </div>
          )}

          {!showSkeleton &&
            messages.map((msg, i) => (
              <div key={i} style={{ animation: 'msg-in 0.3s ease' }}>
                {msg.role === 'user' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div
                      style={{
                        maxWidth: '62%',
                        background: accent,
                        color: userTextColor,
                        padding: '13px 18px',
                        fontSize: '15px',
                        lineHeight: 1.65,
                        boxShadow: `0 4px 20px ${a25}`,
                        fontWeight: 450,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        background: accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: `0 0 14px ${a20}`,
                        marginTop: '2px',
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M2 1v12M2 1h5a3 3 0 0 1 0 6H2M6 7l4 6"
                          stroke={userTextColor}
                          strokeWidth="1.8"
                          strokeLinecap="butt"
                          strokeLinejoin="miter"
                        />
                        <circle cx="7.5" cy="4" r="1.2" fill={userTextColor} />
                      </svg>
                    </div>
                    <div style={{ maxWidth: '74%', minWidth: 0 }}>
                      {msg.content === '' &&
                      isLoading &&
                      i === messages.length - 1 ? (
                        <div
                          style={{
                            background: aiBubbleBg,
                            padding: '16px 18px',
                            border: `1px solid ${chipBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            minWidth: '80px',
                            backdropFilter: 'blur(12px)',
                          }}
                        >
                          <WaveIndicator accent={accent} />
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              background: aiBubbleBg,
                              color: textPrimary,
                              padding: '13px 18px',
                              fontSize: '15px',
                              lineHeight: 1.7,
                              border: `1px solid ${chipBorder}`,
                              backdropFilter: 'blur(12px)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {msg.content}
                          </div>
                          {msg.sources && msg.sources.length > 0 && (
                            <div
                              style={{
                                marginTop: '8px',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '6px',
                              }}
                            >
                              {msg.sources.slice(0, 5).map((src, si) => {
                                const rawName =
                                  src.metadata?.source ||
                                  src.metadata?.filename ||
                                  'Source';
                                const fileName =
                                  rawName.split(/[/\\]/).pop() || rawName;
                                return (
                                  <div
                                    key={si}
                                    style={{
                                      padding: '4px 10px',
                                      background: chipBg,
                                      border: `1px solid ${chipBorder}`,
                                      fontSize: '11px',
                                      color: textSecondary,
                                    }}
                                  >
                                    📄 {fileName}
                                    {src.metadata?.loc?.pageNumber
                                      ? ` · p.${src.metadata.loc.pageNumber}`
                                      : ''}
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
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '12px 24px 18px',
          borderTop: `1px solid ${borderColor}`,
          background: headerBg,
          backdropFilter: 'blur(20px)',
          flexShrink: 0,
        }}
      >
        <div style={{ maxWidth: '740px', margin: '0 auto' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <div
              className="chat-input-wrap"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '10px',
                background: inputBg,
                border: `1px solid ${inputBorderColor}`,
                padding: '10px 16px',
                transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
                boxShadow: inputGlow,
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf"
                multiple
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="plus-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isLoading}
                title={isUploading ? 'Uploading…' : 'Upload PDF'}
                style={{
                  background: accent,
                  border: 'none',
                  color: userTextColor,
                  opacity: isUploading ? 0.5 : 1,
                  boxShadow: `0 0 14px ${a25}`,
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  style={{
                    animation: isUploading
                      ? 'spin 0.8s linear infinite'
                      : 'none',
                  }}
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 12h14m-7-7v14"
                  />
                </svg>
              </button>
              <textarea
                aria-label="Ask about your documents"
                maxLength={8000}
                ref={textareaRef}
                className="chat-input-field"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask Readr anything…"
                rows={1}
                disabled={isLoading || isUploading || !threadId}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: textPrimary,
                  fontSize: '15px',
                  lineHeight: 1.55,
                  fontFamily: 'inherit',
                  maxHeight: '120px',
                  overflowY: 'auto',
                  padding: '4px 0',
                  caretColor: accent,
                  resize: 'none',
                }}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={
                  !input.trim() || isLoading || isUploading || !threadId
                }
                style={{
                  background: accent,
                  color: userTextColor,
                  border: 'none',
                  boxShadow: `0 0 14px ${a25}`,
                  opacity: input.trim() && !isLoading ? 1 : 0.82,
                }}
              >
                <div className="svg-wrapper-1">
                  <div className="svg-wrapper">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                    >
                      <path fill="none" d="M0 0h24v24H0z" />
                      <path
                        fill="currentColor"
                        d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z"
                      />
                    </svg>
                  </div>
                </div>
                <span>Send</span>
              </button>
            </div>
          </form>
          <div
            style={{
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '11px',
              color: textSecondary,
              opacity: 0.4,
              letterSpacing: '0.15px',
            }}
          >
            PDFs: 3 MB each · under 4 MB combined · 100 pages each
          </div>
        </div>
      </div>
    </div>
  );
}
