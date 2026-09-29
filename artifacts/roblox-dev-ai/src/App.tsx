import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Bug,
  Check,
  Code2,
  Command,
  Copy,
  Lightbulb,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  type ChatInputMode,
  type ChatMessage,
  useCreateChatCompletion,
  useHealthCheck,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const STORAGE_KEY = 'roblox-dev-ai-conversations';

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type Mode = ChatInputMode;

const modeDetails: Record<Mode, { label: string; description: string; icon: typeof MessageSquare }> = {
  chat: { label: 'Luau assistant', description: 'Ask anything about your Roblox project', icon: MessageSquare },
  debugger: { label: 'Debugger', description: 'Trace the issue and get a fix path', icon: Bug },
  idea: { label: 'Idea lab', description: 'Shape an original game concept', icon: Lightbulb },
};

const starterPrompts = [
  { label: 'Trace a client/server bug', prompt: 'My RemoteEvent fires twice in a live server. Help me trace the likely causes and show a clean fix.', mode: 'debugger' as Mode },
  { label: 'Build a round system', prompt: 'Help me design a server-authoritative round system in Luau with intermission, countdown, and player cleanup.', mode: 'chat' as Mode },
  { label: 'Find a fresh game loop', prompt: 'Give me three original Roblox game concepts built around a small, replayable social mechanic.', mode: 'idea' as Mode },
];

function makeConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: 'Untitled session', messages: [], createdAt: now, updatedAt: now };
}

function readConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 34) return cleaned;
  return `${cleaned.slice(0, 34).trim()}…`;
}

function InlineMarkdown({ text }: { text: string }) {
  const tokens = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith('`') && token.endsWith('`')) {
          return <code key={index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-secondary">{token.slice(1, -1)}</code>;
        }
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return <a key={index} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-secondary underline decoration-secondary/40 underline-offset-2 hover:decoration-secondary">{linkMatch[1]}</a>;
        }
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={index} className="font-semibold text-slate-100">{token.slice(2, -2)}</strong>;
        }
        return <span key={index}>{token}</span>;
      })}
    </>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(code.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code-surface overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-secondary">{language || 'luau'}</span>
        <button type="button" onClick={() => void copyCode()} className="flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] text-slate-500 transition hover:bg-white/5 hover:text-slate-200" aria-label="Copy code">
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[0.76rem] leading-6 text-slate-300"><code>{code.trim()}</code></pre>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const rendered: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4';
      rendered.push(<Heading key={index} className="font-semibold text-slate-100"><InlineMarkdown text={heading[2]} /></Heading>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ''));
        index += 1;
      }
      rendered.push(<ul key={`ul-${index}`} className="list-disc space-y-1 pl-5">{items.map((item) => <li key={item}><InlineMarkdown text={item} /></li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      rendered.push(<ol key={`ol-${index}`} className="list-decimal space-y-1 pl-5">{items.map((item) => <li key={item}><InlineMarkdown text={item} /></li>)}</ol>);
      continue;
    }
    rendered.push(<p key={index}><InlineMarkdown text={line} /></p>);
    index += 1;
  }

  return <>{rendered}</>;
}

function MessageBody({ content }: { content: string }) {
  const blocks = content.split('```');
  return (
    <div className="space-y-3 text-[0.93rem] leading-7">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const lines = block.split('\n');
          const language = lines[0]?.trim();
          const code = language && !language.includes(' ') ? lines.slice(1).join('\n') : block;
          return <CodeBlock key={`${index}-${code.slice(0, 10)}`} code={code} language={language} />;
        }
        return block.trim() ? <MarkdownText key={`${index}-${block.slice(0, 10)}`} text={block.trim()} /> : null;
      })}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark" aria-hidden="true">
        <Code2 size={17} strokeWidth={1.8} />
      </div>
      <div>
        <div className="font-semibold tracking-tight text-slate-100">Roblox Dev AI</div>
        <div className="mono-label mt-1 text-slate-500">studio companion</div>
      </div>
    </div>
  );
}

function Sidebar({
  conversations,
  activeId,
  search,
  editingId,
  onSearch,
  onSelect,
  onNew,
  onBeginRename,
  onRename,
  onDelete,
  isOpen,
  onClose,
}: {
  conversations: Conversation[];
  activeId: string | null;
  search: string;
  editingId: string | null;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onBeginRename: (id: string) => void;
  onRename: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const filteredConversations = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle) || conversation.messages.some((message) => message.content.toLowerCase().includes(needle)));
  }, [conversations, search]);

  return (
    <>
      {isOpen && <button type="button" className="mobile-scrim md:hidden" aria-label="Close navigation" data-testid="button-close-mobile-drawer" onClick={onClose} />}
      <aside className={`sidebar-panel ${isOpen ? 'is-open' : ''}`} aria-label="Conversation history">
        <div className="flex items-center justify-between px-5 pb-6 pt-6">
          <Brand />
          <button type="button" className="focus-ring rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200 md:hidden" onClick={onClose} aria-label="Close conversation history" data-testid="button-close-sidebar">
            <X size={18} />
          </button>
        </div>

        <div className="px-4">
          <button type="button" className="group flex w-full items-center justify-between rounded-lg border border-primary/50 bg-primary/10 px-3.5 py-2.5 text-sm font-semibold text-slate-100 shadow-sm transition hover:border-primary hover:bg-primary/15" onClick={onNew} data-testid="button-new-chat">
            <span className="flex items-center gap-2.5"><Plus size={16} /> New chat</span>
            <span className="mono-label rounded border border-primary/30 px-1.5 py-1 text-primary/80">⌘ K</span>
          </button>
        </div>

        <div className="px-4 pb-4 pt-6">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={15} />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              className="focus-ring h-9 w-full rounded-md border border-sidebar-border bg-sidebar-accent/60 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600"
              placeholder="Search history"
              aria-label="Search conversation history"
              data-testid="input-search-history"
            />
          </label>
        </div>

        <div className="flex items-center justify-between px-5 pb-2">
          <span className="mono-label text-slate-600">Recent sessions</span>
          <span className="font-mono text-[10px] text-slate-600">{filteredConversations.length.toString().padStart(2, '0')}</span>
        </div>

        <div className="history-scroll flex-1 overflow-y-auto px-3">
          {filteredConversations.length === 0 ? (
            <div className="mx-2 mt-4 rounded-lg border border-dashed border-sidebar-border px-3 py-5 text-center">
              <p className="text-xs font-medium text-slate-500">{search ? 'No matching sessions' : 'Your sessions will live here'}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-600">{search ? 'Try a different search term.' : 'Start with a prompt and build your local library.'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conversation) => (
                <div key={conversation.id} className={`history-item group relative rounded-md ${conversation.id === activeId ? 'is-active' : ''}`} data-testid={`history-item-${conversation.id}`}>
                  {editingId === conversation.id ? (
                    <input
                      autoFocus
                      defaultValue={conversation.title}
                      className="focus-ring my-1.5 ml-2 w-[calc(100%-16px)] rounded bg-sidebar-accent px-2 py-1.5 text-xs text-slate-100 outline-none"
                      aria-label="Rename conversation"
                      data-testid={`input-rename-${conversation.id}`}
                      onBlur={(event) => onRename(conversation.id, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onRename(conversation.id, event.currentTarget.value);
                        if (event.key === 'Escape') onRename(conversation.id, conversation.title);
                      }}
                    />
                  ) : (
                    <button type="button" className="flex w-full items-start gap-3 px-3 py-3 text-left" onClick={() => onSelect(conversation.id)} data-testid={`button-select-conversation-${conversation.id}`}>
                      <MessageSquare size={14} className={`mt-0.5 shrink-0 ${conversation.id === activeId ? 'text-primary' : 'text-slate-600'}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-medium ${conversation.id === activeId ? 'text-slate-100' : 'text-slate-400'}`}>{conversation.title}</span>
                        <span className="mt-1 block font-mono text-[10px] text-slate-600">{formatRelativeDate(conversation.updatedAt)}</span>
                      </span>
                    </button>
                  )}
                  {editingId !== conversation.id && (
                    <span className="absolute right-2 top-2 hidden items-center gap-0.5 rounded bg-sidebar-accent p-0.5 group-hover:flex">
                      <button type="button" className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200" onClick={() => onBeginRename(conversation.id)} aria-label={`Rename ${conversation.title}`} data-testid={`button-rename-conversation-${conversation.id}`}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" className="rounded p-1 text-slate-500 hover:bg-destructive/15 hover:text-destructive" onClick={() => onDelete(conversation.id)} aria-label={`Delete ${conversation.title}`} data-testid={`button-delete-conversation-${conversation.id}`}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-sidebar-border px-4 py-4">
          <div className="flex items-center justify-between rounded-md border border-sidebar-border bg-sidebar-accent/35 px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs text-slate-400"><Settings2 size={14} /> Local workspace</span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> saved</span>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-slate-600">Conversations stay in this browser. Nothing is synced until you choose to copy it into Studio.</p>
        </div>
      </aside>
    </>
  );
}

function EmptyState({ onPrompt }: { onPrompt: (prompt: string, mode: Mode) => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-16 sm:px-8">
      <div className="message-enter mb-10">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-secondary/25 bg-secondary/8 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-secondary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" /> Ready for Studio
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.03] tracking-[-0.045em] text-slate-100 sm:text-6xl">Build better games,<br /><span className="text-primary">one clean script</span> at a time.</h1>
        <p className="mt-6 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">Expert Luau help for the moments that slow a Studio session down. Debug the weird stuff, shape the good ideas, and keep moving.</p>
      </div>

      <div className="message-enter grid gap-2.5 sm:grid-cols-3" style={{ animationDelay: '90ms' }}>
        {starterPrompts.map((starter, index) => {
          const Icon = starter.mode === 'debugger' ? Bug : starter.mode === 'idea' ? Lightbulb : Code2;
          return (
            <button type="button" key={starter.label} className="group rounded-xl border border-border bg-card/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-secondary/45 hover:bg-card" onClick={() => onPrompt(starter.prompt, starter.mode)} data-testid={`button-starter-prompt-${index}`}>
              <span className="mb-5 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-slate-400 transition group-hover:border-secondary/40 group-hover:text-secondary"><Icon size={15} /></span>
              <span className="block text-sm font-medium text-slate-200">{starter.label}</span>
              <span className="mt-1.5 block text-xs leading-5 text-slate-500">{modeDetails[starter.mode].description}</span>
            </button>
          );
        })}
      </div>
      <p className="mono-label mt-7 text-slate-600">or describe what you are building below</p>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="message-enter flex items-start gap-3 px-5 py-6 sm:px-8">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-secondary/35 bg-secondary/10 text-secondary"><Bot size={15} /></div>
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-secondary" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-secondary" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-secondary" />
        <span className="ml-2 font-mono text-[10px] text-slate-500">reasoning</span>
      </div>
    </div>
  );
}

function ChatMessageView({ message, index, model, onRegenerate }: { message: ChatMessage; index: number; model?: string; onRegenerate?: () => void }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const copyResponse = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`message-enter flex items-start gap-3 px-5 py-6 sm:px-8 ${isUser ? 'justify-end' : ''}`} style={{ animationDelay: `${Math.min(index * 35, 140)}ms` }} data-testid={`message-${message.role}-${index}`}>
      {!isUser && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-secondary/35 bg-secondary/10 text-secondary"><Bot size={15} /></div>}
      <div className={`max-w-3xl ${isUser ? 'order-first' : ''}`}>
        <div className={`mb-1.5 flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          <span className="mono-label text-slate-600">{isUser ? 'you' : 'roblox dev ai'}</span>
          {!isUser && model && <span className="font-mono text-[9px] text-slate-700">{model}</span>}
        </div>
        <div className={`rounded-xl border px-4 py-3.5 ${isUser ? 'border-primary/25 bg-primary/10 text-slate-200' : 'border-border bg-card/75 text-slate-300'}`}>
          <MessageBody content={message.content} />
        </div>
         {!isUser && (
           <div className="mt-2 flex items-center gap-1">
             <button type="button" onClick={() => void copyResponse()} className="flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] text-slate-600 transition hover:bg-white/5 hover:text-slate-300" aria-label="Copy response">
               {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
               {copied ? 'Copied' : 'Copy response'}
             </button>
             {onRegenerate && (
               <button type="button" onClick={onRegenerate} className="flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] text-slate-600 transition hover:bg-white/5 hover:text-slate-300" aria-label="Regenerate response">
                 <RotateCcw size={12} /> Regenerate
               </button>
             )}
           </div>
         )}
      </div>
      {isUser && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"><Command size={15} /></div>}
    </div>
  );
}

function Composer({
  mode,
  context,
  value,
  pending,
  onMode,
  onContext,
  onValue,
  onSubmit,
  onStop,
}: {
  mode: Mode;
  context: string;
  value: string;
  pending: boolean;
  onMode: (mode: Mode) => void;
  onContext: (context: string) => void;
  onValue: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const [showContext, setShowContext] = useState(Boolean(context));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !pending) onSubmit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-4 sm:px-8 sm:pb-6">
      <div className="composer-glow overflow-hidden rounded-xl border border-border bg-card/90 shadow-lg transition">
        {showContext && (
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="mono-label shrink-0 text-secondary">context</span>
              <input type="text" value={context} onChange={(event) => onContext(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-600" placeholder="Paste a script path, error, or Studio detail (optional)" aria-label="Optional Studio context" data-testid="input-studio-context" />
              <button type="button" className="rounded p-1 text-slate-600 hover:bg-white/5 hover:text-slate-300" onClick={() => setShowContext(false)} aria-label="Hide context field" data-testid="button-hide-context"><X size={14} /></button>
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={handleKeyDown}
          className="max-h-[180px] min-h-[58px] w-full resize-none bg-transparent px-4 pb-2 pt-4 text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-600"
          placeholder={pending ? 'Waiting for the assistant…' : mode === 'debugger' ? 'Describe the bug, error, or unexpected behavior…' : mode === 'idea' ? 'What kind of game should we explore?' : 'Ask about Luau, systems, APIs, or your next feature…'}
          aria-label="Message Roblox Dev AI"
          data-testid="input-chat-message"
          disabled={pending}
        />
        <div className="flex items-center justify-between px-3 pb-3 pt-1.5">
          <div className="flex items-center gap-1.5">
            {(Object.keys(modeDetails) as Mode[]).map((option) => {
              const Icon = modeDetails[option].icon;
              return (
                <button type="button" key={option} className={`mode-button flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-[11px] font-medium text-slate-500 ${mode === option ? 'is-selected' : ''}`} onClick={() => onMode(option)} aria-pressed={mode === option} data-testid={`button-mode-${option}`}>
                  <Icon size={13} /> <span className="hidden sm:inline">{modeDetails[option].label}</span>
                </button>
              );
            })}
            {!showContext && <button type="button" className="ml-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-slate-600 transition hover:bg-white/5 hover:text-slate-300" onClick={() => setShowContext(true)} data-testid="button-add-context"><Plus size={13} /> <span className="hidden sm:inline">Context</span></button>}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] text-slate-600 sm:inline">shift + enter for newline</span>
            <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-md text-primary-foreground transition ${pending ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'} disabled:cursor-not-allowed disabled:opacity-35`} onClick={pending ? onStop : onSubmit} disabled={!pending && !value.trim()} aria-label={pending ? 'Stop generating' : 'Send message'} data-testid={pending ? 'button-stop-generating' : 'button-send-message'}>
              {pending ? <Square size={13} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pt-2">
        {[
          ['Luau Script', 'Write a complete Luau script for a Roblox feature and explain where it belongs.', 'chat'],
          ['Debug Code', 'Debug this Roblox Luau code and return the problem, fixed code, and test steps.', 'debugger'],
          ['Game Idea', 'Generate an original Roblox game concept with a strong core loop.', 'idea'],
          ['Roblox UI', 'Help me build a polished Roblox UI system in Luau.', 'chat'],
          ['Gamepass', 'How should I securely implement a Roblox gamepass?', 'chat'],
          ['Optimization', 'How can I optimize this Roblox game for performance?', 'chat'],
          ['Obby System', 'Help me build a checkpoint and respawn system for an obby.', 'chat'],
          ['Save System', 'Show me a safe DataStore save and load pattern.', 'chat'],
        ].map(([label, prompt, promptMode]) => (
          <button type="button" key={label} onClick={() => { onMode(promptMode as Mode); onValue(prompt); }} className="shrink-0 rounded-md border border-border px-2.5 py-1.5 font-mono text-[10px] text-slate-600 transition hover:border-secondary/35 hover:text-slate-300" data-testid={`button-suggestion-${label.toLowerCase().replaceAll(' ', '-')}`}>{label}</button>
        ))}
      </div>
      <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-slate-700">Responses are generated for your local development workflow</p>
    </div>
  );
}

function ChatWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('chat');
  const [context, setContext] = useState('');
  const [draft, setDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const generationToken = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatCompletion = useCreateChatCompletion();
  const { data: health, isLoading: healthLoading, isError: healthError } = useHealthCheck();

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [activeConversation?.messages.length, chatCompletion.isPending]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        createNewConversation();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  const createNewConversation = () => {
    setActiveId(null);
    setDraft('');
    setErrorMessage(null);
    setMobileOpen(false);
  };

  const selectConversation = (id: string) => {
    setActiveId(id);
    setErrorMessage(null);
    setMobileOpen(false);
  };

  const updateConversation = (id: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((current) => current.map((conversation) => conversation.id === id ? updater(conversation) : conversation));
  };

  const requestResponse = async (conversationId: string, messages: ChatMessage[], selectedMode: Mode) => {
    setErrorMessage(null);
    const token = generationToken.current + 1;
    generationToken.current = token;
    setIsGenerating(true);
    try {
      const response = await chatCompletion.mutateAsync({ data: { messages, mode: selectedMode, ...(context.trim() ? { context: context.trim() } : {}) } });
      if (token !== generationToken.current) return;
      setLastModel(response.model);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, { role: 'assistant', content: response.message }],
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (token !== generationToken.current) return;
      const message = error instanceof Error ? error.message : 'The assistant could not respond right now.';
      setErrorMessage(message);
    } finally {
      if (token === generationToken.current) setIsGenerating(false);
    }
  };

  const sendPrompt = async (prompt: string, selectedMode = mode) => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    let conversation = activeConversation;
    if (!conversation) {
      conversation = makeConversation();
      setConversations((current) => [conversation as Conversation, ...current]);
      setActiveId(conversation.id);
    }
    const nextMessages: ChatMessage[] = [...conversation.messages, { role: 'user', content: trimmed }];
    updateConversation(conversation.id, (current) => ({
      ...current,
      title: current.messages.length === 0 ? titleFromPrompt(trimmed) : current.title,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
    }));
    setDraft('');
    await requestResponse(conversation.id, nextMessages, selectedMode);
  };

  const retryLast = () => {
    if (!activeConversation || isGenerating) return;
    const lastUserIndex = [...activeConversation.messages].map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex >= 0) {
      const requestMessages = activeConversation.messages.slice(0, lastUserIndex + 1);
      updateConversation(activeConversation.id, (conversation) => ({ ...conversation, messages: requestMessages, updatedAt: new Date().toISOString() }));
      void requestResponse(activeConversation.id, requestMessages, mode);
    }
  };

  const stopGenerating = () => {
    generationToken.current += 1;
    setIsGenerating(false);
    setErrorMessage(null);
  };

  const renameConversation = (id: string, value: string) => {
    const title = value.trim();
    if (title) updateConversation(id, (conversation) => ({ ...conversation, title }));
    setEditingId(null);
  };

  const deleteConversation = (id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation || !window.confirm(`Delete "${conversation.title}"?`)) return;
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendPrompt(draft);
  };

  return (
    <div className="app-shell">
      <div className="workspace-grid">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          search={search}
          editingId={editingId}
          onSearch={setSearch}
          onSelect={selectConversation}
          onNew={createNewConversation}
          onBeginRename={setEditingId}
          onRename={renameConversation}
          onDelete={deleteConversation}
          isOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />

        <main className="content-panel">
          <header className="topbar flex items-center justify-between px-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="focus-ring rounded-md p-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-200 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open conversation history" data-testid="button-open-sidebar"><Menu size={19} /></button>
              <div className="min-w-0" data-testid="text-workspace-title">
                <div className="flex items-center gap-2">
                  <span className="mono-label text-slate-600">workspace /</span>
                  <span className="truncate text-sm font-medium text-slate-300">{activeConversation?.title ?? 'new session'}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600">
                  <span className="flex items-center gap-1.5" data-testid="status-api-health"><span className={`h-1.5 w-1.5 rounded-full ${healthError ? 'bg-destructive' : 'bg-emerald-400'}`} /> {healthLoading ? 'checking api' : healthError ? 'api unavailable' : health?.status ?? 'api ready'}</span>
                  <span className="text-slate-700">·</span>
                  <span>local history enabled</span>
                </div>
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="mono-label text-slate-700">mode</span>
              <span className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-[11px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> {modeDetails[mode].label}</span>
            </div>
          </header>

          <div ref={messagesRef} className="messages-scroll flex-1 overflow-y-auto">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <EmptyState onPrompt={(prompt, selectedMode) => { setMode(selectedMode); void sendPrompt(prompt, selectedMode); }} />
            ) : (
              <div className="mx-auto w-full max-w-4xl pb-8 pt-5">
                {activeConversation.messages.map((message, index) => <ChatMessageView key={`${activeConversation.id}-${index}`} message={message} index={index} model={index === activeConversation.messages.length - 1 ? lastModel : undefined} onRegenerate={!isGenerating && message.role === 'assistant' && index === activeConversation.messages.length - 1 ? retryLast : undefined} />)}
                {isGenerating && <TypingIndicator />}
                {errorMessage && (
                  <div className="message-enter mx-5 mb-4 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-3 text-xs text-red-200 sm:mx-8" role="alert" data-testid="status-chat-error">
                    <span className="flex items-center gap-2"><AlertTriangle size={15} className="shrink-0 text-destructive" /> {errorMessage}</span>
                    <button type="button" className="flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/35 px-2 py-1.5 font-medium text-red-100 transition hover:bg-destructive/15" onClick={retryLast} data-testid="button-retry-message"><RotateCcw size={13} /> Retry</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            <Composer mode={mode} context={context} value={draft} pending={isGenerating} onMode={setMode} onContext={setContext} onValue={setDraft} onSubmit={() => void sendPrompt(draft)} onStop={stopGenerating} />
          </form>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={ChatWorkspace} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;