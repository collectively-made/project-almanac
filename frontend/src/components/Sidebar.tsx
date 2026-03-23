import { useEffect, useState } from "react";

interface Thread {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

interface SidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ activeThreadId, onSelectThread, onNewChat, isOpen, onClose }: SidebarProps) {
  const [threads, setThreads] = useState<Thread[]>([]);

  const loadThreads = () => {
    fetch("/api/threads")
      .then((r) => r.json())
      .then(setThreads)
      .catch(() => {});
  };

  useEffect(() => {
    loadThreads();
    // Refresh periodically while open
    if (isOpen) {
      const id = setInterval(loadThreads, 5000);
      return () => clearInterval(id);
    }
  }, [isOpen, activeThreadId]);

  const handleDelete = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    loadThreads();
    if (activeThreadId === threadId) {
      onNewChat();
    }
  };

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const grouped: { label: string; threads: Thread[] }[] = [];
  const todayThreads: Thread[] = [];
  const yesterdayThreads: Thread[] = [];
  const olderThreads: Thread[] = [];

  for (const t of threads) {
    const d = new Date(t.updated_at + "Z").toDateString();
    if (d === today) todayThreads.push(t);
    else if (d === yesterday) yesterdayThreads.push(t);
    else olderThreads.push(t);
  }
  if (todayThreads.length) grouped.push({ label: "Today", threads: todayThreads });
  if (yesterdayThreads.length) grouped.push({ label: "Yesterday", threads: yesterdayThreads });
  if (olderThreads.length) grouped.push({ label: "Earlier", threads: olderThreads });

  return (
    <>
      {/* Backdrop */}
      {isOpen && <div className="sidebar-backdrop" onClick={onClose} />}

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <button className="sidebar-new" onClick={() => { onNewChat(); onClose(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            New chat
          </button>
          <button className="sidebar-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="sidebar-list">
          {threads.length === 0 && (
            <p className="sidebar-empty">No conversations yet</p>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="sidebar-group">
              <div className="sidebar-group-label">{group.label}</div>
              {group.threads.map((t) => (
                <button
                  key={t.id}
                  className={`sidebar-item ${t.id === activeThreadId ? "active" : ""}`}
                  onClick={() => { onSelectThread(t.id); onClose(); }}
                >
                  <span className="sidebar-item-title">{t.title}</span>
                  <button
                    className="sidebar-item-delete"
                    onClick={(e) => handleDelete(e, t.id)}
                    title="Delete"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </button>
              ))}
            </div>
          ))}
        </div>

        <style>{`
          .sidebar-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 90;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 280px;
            background: var(--bg-elevated);
            border-right: 1px solid var(--border);
            z-index: 100;
            display: flex;
            flex-direction: column;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
          }
          .sidebar-new {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 14px;
            background: var(--accent);
            color: var(--bg);
            border: none;
            border-radius: 6px;
            font-family: var(--font-body);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: filter 0.15s;
          }
          .sidebar-new:hover { filter: brightness(1.1); }
          .sidebar-close {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.15s;
          }
          .sidebar-close:hover { color: var(--text); background: var(--bg-card); }
          .sidebar-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
          }
          .sidebar-empty {
            text-align: center;
            color: var(--text-dim);
            font-size: 13px;
            padding: 20px;
          }
          .sidebar-group {
            margin-bottom: 8px;
          }
          .sidebar-group-label {
            font-family: var(--font-mono);
            font-size: 10px;
            font-weight: 500;
            color: var(--text-dim);
            letter-spacing: 0.1em;
            padding: 8px 10px 4px;
            text-transform: uppercase;
          }
          .sidebar-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 8px 10px;
            background: none;
            border: none;
            border-radius: 6px;
            color: var(--text-muted);
            font-family: var(--font-body);
            font-size: 13px;
            text-align: left;
            cursor: pointer;
            transition: all 0.1s;
            gap: 8px;
          }
          .sidebar-item:hover {
            background: var(--bg-card);
            color: var(--text);
          }
          .sidebar-item.active {
            background: var(--accent-dim);
            color: var(--text-bright);
          }
          .sidebar-item-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .sidebar-item-delete {
            display: none;
            width: 20px;
            height: 20px;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            color: var(--text-dim);
            cursor: pointer;
            border-radius: 3px;
            flex-shrink: 0;
          }
          .sidebar-item:hover .sidebar-item-delete {
            display: flex;
          }
          .sidebar-item-delete:hover {
            color: var(--danger);
            background: var(--danger-dim);
          }
        `}</style>
      </aside>
    </>
  );
}
