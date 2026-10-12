import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, RequestError, type ChatMessage, type ChatSession } from "../api";
import { rumAction } from "../rum";

const SESSION_KEY = "nusabank.chat";
const SUGGESTIONS = ["Biaya transfer BI FAST?", "Cara top up GoPay", "Simulasi cicilan KPR", "Saya mau bicara dengan petugas"];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Resume this tab's session if it still exists; otherwise start fresh on first open.
  useEffect(() => {
    if (!open || session) return;
    const saved = sessionStorage.getItem(SESSION_KEY);
    const start = () => api.post<ChatSession>("/api/chat/sessions").then((s) => {
      sessionStorage.setItem(SESSION_KEY, s.id);
      setSession(s);
    });
    (saved ? api.get<ChatSession>(`/api/chat/sessions/${saved}`).then(setSession).catch(start) : start())
      .catch(() => setError("Chat belum dapat dimuat"));
  }, [open, session]);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect must
  // not return anything but a cleanup function (React calls it and crashes otherwise).
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages?.length, open]);

  const send = async (text: string) => {
    if (!session || !text.trim()) return;
    const mine: ChatMessage = { id: crypto.randomUUID(), role: "customer", content: text.trim(), created_at: new Date().toISOString() };
    setSession({ ...session, messages: [...(session.messages ?? []), mine] });
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const reply = await api.post<ChatMessage>(`/api/chat/sessions/${session.id}/messages`, { content: mine.content });
      setSession((s) => s && { ...s, status: reply.role === "agent_handoff" ? "HANDED_OFF" : s.status, messages: [...(s.messages ?? []), reply] });
      rumAction("chat_message_sent", { handoff: reply.role === "agent_handoff" });
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Tidak dapat terhubung, silakan coba lagi");
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  if (!open) return <button className="chat-fab primary" onClick={() => setOpen(true)}>Bantuan</button>;

  const handedOff = session?.status !== undefined && session.status !== "OPEN";
  return (
    <div className="chat-panel card">
      <div className="chat-head">
        <strong>Asisten Nusa Bank</strong>
        <button className="link" onClick={() => setOpen(false)}>Tutup</button>
      </div>
      <div className="chat-body">
        {(session?.messages ?? []).map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="bubble assistant muted">Mengetik…</div>}
        <div ref={end} />
      </div>
      {error && <div className="alert small">{error}</div>}
      {handedOff ? (
        <div className="chat-foot small muted">
          Percakapan diteruskan ke petugas. <button className="link" onClick={restart}>Mulai sesi baru</button>
        </div>
      ) : (
        <>
          {(session?.messages?.length ?? 0) <= 1 && (
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={busy}>{s}</button>)}
            </div>
          )}
          <form className="chat-foot" onSubmit={onSubmit}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tulis pertanyaan…" maxLength={2000} disabled={!session || busy} />
            <button className="primary" disabled={!session || busy || !draft.trim()}>Kirim</button>
          </form>
        </>
      )}
    </div>
  );
}
