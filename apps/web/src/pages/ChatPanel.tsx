import type { ChatMessage } from "@felt/shared";
import { useEffect, useRef, useState } from "react";

type Props = {
  messages: ChatMessage[];
  onSend: (text: string) => void;
};

export function ChatPanel({ messages, onSend }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">No messages yet.</div>
        ) : (
          messages.map((m) =>
            m.system ? (
              <div className="chat-msg chat-msg-system" key={m.id}>
                {m.text}
              </div>
            ) : (
              <div className="chat-msg" key={m.id}>
                <span className="chat-author">{m.displayName}:</span> {m.text}
              </div>
            ),
          )
        )}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          maxLength={500}
        />
        <button type="submit" disabled={text.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}
