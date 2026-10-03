import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { flushNoteSave, applyNoteEdit, applyNoteEditVerified, hashNoteContent } from "@/lib/note-ai-edit";
import { toast } from "sonner";


import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { summarizeChat } from "@/lib/chat-summary";
import { functionErrorMessage, OUT_OF_CREDITS_MESSAGE } from "@/lib/function-error";
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildApiMessages,
  withSummary,
  NOTE_MODIFYING_TOOLS,
  NOTE_CREATING_TOOLS,
  COLLECTION_MODIFYING_TOOLS,
  type PersistedChatMessage,
  type PersistedChatState,
} from "@/lib/chat-history";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Bot,
  X,
  Send,
  Loader2,
  User,
  Wrench,
  AlertCircle,
  Trash2,
  FilePlus2,
  Maximize2,
  Minimize2,
  Expand,
  Shrink,
  ExternalLink,
} from "lucide-react";
// Lazy: this component is in DashboardLayout, so a static import put the
// Markdown stack into the main chunk. See ChatMarkdown.tsx.
const ChatMarkdown = lazy(() => import("./ChatMarkdown"));

import ChatComposer, {type ChatFile} from "./ChatComposer";
type ChatMessage = PersistedChatMessage;
type SizeMode = "docked" | "expanded" | "fullscreen";

const SIZE_STORAGE_KEY = "menerio:chat-fab-size";

function loadSizeMode(): SizeMode {
  if (typeof window === "undefined") return "docked";
  const v = window.localStorage.getItem(SIZE_STORAGE_KEY);
  return v === "expanded" || v === "fullscreen" ? v : "docked";
}

export function GlobalAIChatFAB({page=false}:{page?:boolean}) {
  const { user, session } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(page);
  const [confirm, confirmDialog] = useConfirmDialog();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeMode, setSizeModeState] = useState<SizeMode>(() => loadSizeMode());
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef=useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [contextTitle,setContextTitle]=useState("");
  const [files,setFiles]=useState<ChatFile[]>([]),[model,setModel]=useState(''),[effort,setEffort]=useState('');
  const requestRef=useRef<string|null>(null),stoppedRef=useRef(false);
  const stopReply=async()=>{if(requestRef.current){stoppedRef.current=true;await fetch('/api/chat/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:requestRef.current})});}};

  const setSizeMode = useCallback((m: SizeMode) => {
    setSizeModeState(m);
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, m);
    } catch {
      // ignore
    }
  }, []);

  // Force docked on mobile (expanded == docked visually there)
  const effectiveMode: SizeMode = isMobile && sizeMode === "expanded" ? "docked" : sizeMode;

  // Detect note context from the current route
  const noteId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/notes\/([^/]+)$/);
    return match ? match[1] : page?new URLSearchParams(location.search).get("note"):null;
  }, [location.pathname,location.search,page]);

  // Detect person context (People profile page) so the assistant knows whose
  // profile the user is looking at
  const personId = useMemo(() => {
    const match = location.pathname.match(/^\/dashboard\/people\/([^/]+)$/);
    return match ? match[1] : page?new URLSearchParams(location.search).get("person"):null;
  }, [location.pathname,location.search,page]);

  // Detect collection context from /collections/:slug and optional /:itemId
  const collectionSlug = useMemo(() => {
    const match = location.pathname.match(/^\/collections\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const collectionItemId = useMemo(() => {
    // /collections/:slug/:itemId - but skip reserved subroutes like /schema
    const match = location.pathname.match(/^\/collections\/[^/]+\/([^/]+)$/);
    if (!match) return null;
    const seg = match[1];
    if (seg === "schema" || seg === "new") return null;
    return seg;
  }, [location.pathname]);


  const [collectionId, setCollectionId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!collectionSlug || !user) {
      setCollectionId(null);
      return;
    }
    supabase
      .from("collections")
      .select("id")
      .eq("slug", collectionSlug)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCollectionId(data?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionSlug, user?.id]);

  const contextKey = collectionId
    ? `collection:${collectionId}`
    : noteId
      ? `note:${noteId}`
      : personId
        ? `person:${personId}`
        : "general";

  useEffect(()=>{setContextTitle('');if(noteId)supabase.from('notes').select('title').eq('id',noteId).single().then(({data}:any)=>setContextTitle(data?.title||'Untitled note'));else if(personId)supabase.from('contacts').select('name').eq('id',personId).single().then(({data}:any)=>setContextTitle(data?.name||'Current person'));},[noteId,personId]);

  // Persisted chat state for the current context
  const [state, setState] = useState<PersistedChatState>(() =>
    loadChatState(user?.id, contextKey),
  );

  // Re-hydrate when context (note or general) changes
  useEffect(() => {
    setState(loadChatState(user?.id, contextKey));
    setError(null);
  }, [contextKey, user?.id]);

  // Persist on every change
  useEffect(() => {
    saveChatState(user?.id, contextKey, state);
  }, [state, contextKey, user?.id]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+K; Escape steps size down before closing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if(page)return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape" && open) {
        if (effectiveMode === "fullscreen") {
          setSizeMode(isMobile ? "docked" : "expanded");
        } else if (effectiveMode === "expanded") {
          setSizeMode("docked");
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page, open, effectiveMode, isMobile, setSizeMode]);

  useEffect(()=>{if(open)setState(loadChatState(user?.id,contextKey));},[open]);

  // Focus textarea when opened
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-scroll to the newest message. Runs on new messages, while loading,
  // AND when the panel is (re)opened or resized - reopening remounts the
  // scroll container at the top, so without `open`/`effectiveMode` here you'd
  // land on the first message and have to scroll down manually. The rAF waits
  // for layout (and markdown/images) to settle before pinning to the bottom.
  useEffect(() => {
    if (!open||!followRef.current) return;
    const pinToBottom = () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    };
    pinToBottom();
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [state.messages, isLoading, open, effectiveMode]);

  // The conversation a reply belongs to. The panel stays open while the user
  // moves between notes, and a reply takes 10 to 30 seconds: applying it to
  // whatever conversation is open by then replaced that one's saved history
  // with the other's, and the conversation that asked never got its answer.
  const chatKey = `${user?.id ?? "anon"}|${contextKey}`;
  const chatKeyRef = useRef(chatKey);
  useEffect(() => {
    chatKeyRef.current = chatKey;
  }, [chatKey]);
  const summarizingRef = useRef(false);

  /** Put a finished turn where it belongs: on screen if its conversation is open, else into its saved history. */
  const deliver = useCallback(
    (key: string, userId: string | undefined, ctx: string, next: PersistedChatState) => {
      if (chatKeyRef.current === key) setState(next);
      else saveChatState(userId, ctx, next);
    },
    [],
  );

  /** Fold older turns into the summary after the reply is shown, without holding it back. */
  const summarizeLater = useCallback(
    (chatFn: "note-chat" | "collection-chat", key: string, userId: string | undefined, ctx: string, from: PersistedChatState) => {
      if (summarizingRef.current) return;
      summarizingRef.current = true;
      void summarizeChat(chatFn, from)
        .then((res) => {
          if (!res) return;
          if (chatKeyRef.current === key) {
            setState((prev) => withSummary(prev, res.summary, res.upTo, res.messageCount));
          } else {
            saveChatState(userId, ctx, withSummary(loadChatState(userId, ctx), res.summary, res.upTo, res.messageCount));
          }
        })
        .finally(() => {
          summarizingRef.current = false;
        });
    },
    [],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text&&!files.length) || isLoading || requestRef.current || !session) return;

    setError(null);
    const sentKey = chatKey;
    const sentUserId = user?.id;
    const sentContext = contextKey;
    const userMsg: ChatMessage = { role: "user", content: text||"Please describe the attached files.", attachments:files };
    const nextState: PersistedChatState = {
      ...state,
      messages: [...state.messages, userMsg],
    };
    followRef.current=true;setState(nextState);
    setInput("");
    setIsLoading(true);stoppedRef.current=false;requestRef.current=crypto.randomUUID();

    try {
      const apiMessages = buildApiMessages(nextState);
      const chatFn = collectionId ? "collection-chat" : "note-chat";
      // Flush the open editor's pending autosave so the agent edits on top of
      // the user's newest text (and knows which version it is based on).
      const flushed =
        noteId && !collectionId
          ? await flushNoteSave(noteId)
          : { updatedAt: null, content: null };
      const invokeBody = collectionId
        ? {
            collection_id: collectionId,
            item_id: collectionItemId || undefined,
            messages: apiMessages,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : {
            note_id: noteId || undefined,
            base_updated_at: flushed.updatedAt,
            base_content_hash:
              flushed.content !== null ? hashNoteContent(flushed.content) : undefined,
            person_id: personId || undefined,
            messages: apiMessages,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };


      const { data, error: fnErr } = await supabase.functions.invoke(chatFn, {
        body: {...invokeBody,files:files.length?files:state.messages.slice().reverse().find(m=>m.attachments?.length)?.attachments||[],model:model||undefined,effort:effort||undefined,request_id:requestRef.current},
      });

      // A non-2xx answer (out of credits is a 402) arrives as fnErr with
      // data null, so the reason is read from the answer itself.
      if (fnErr) {
        throw new Error(await functionErrorMessage(fnErr, "The assistant could not answer. Please try again."));
      }

      if (data?.error) {
        throw new Error(
          data.error === "Insufficient AI credits" || data.code === "INSUFFICIENT_CREDITS"
            ? OUT_OF_CREDITS_MESSAGE
            : "The assistant could not answer. Please try again.",
        );
      }

      const notesCreated: ChatMessage["notesCreated"] = Array.isArray(data.notes_created)
        ? data.notes_created
        : undefined;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.reply || "",
        toolResults: data.tool_results,
        ...(notesCreated?.length ? { notesCreated } : {}),
      };
      const updated: PersistedChatState = {
        ...nextState,
        messages: [...nextState.messages, assistantMsg],
      };

      // If a note-modifying tool ran, refresh the editor live + invalidate queries.
      // `note_edit` carries the exact resulting content, so the editor can apply
      // it without refetching and without losing the user's in-flight text.
      if (
        noteId &&
        (data.note_edit ||
          data.tool_results?.some((tr: any) => NOTE_MODIFYING_TOOLS.includes(tr.tool)))
      ) {
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        const result = await applyNoteEditVerified(
          noteId,
          data.note_edit?.content ?? null,
          data.note_edit?.updated_at ?? null,
        );
        if (result.status === "failed") {
          toast.warning("Saved. The editor view may be out of date.", {
            description: "Reload the note to see the change.",

            action: {
              label: "Reload note",
              onClick: () => {
                queryClient.invalidateQueries({ queryKey: ["note", noteId] });
                applyNoteEdit(noteId, null, null);
              },
            },
          });
        }
      }



      // A created note is a new row and possibly a new folder, so both the note
      // list and the folder tree need to refetch. This is independent of
      // `noteId`: the general assistant creates notes with no note open.
      if (
        notesCreated?.length ||
        data.folders_created?.length ||
        data.tool_results?.some((tr: any) => NOTE_CREATING_TOOLS.includes(tr.tool))
      ) {
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        queryClient.invalidateQueries({ queryKey: ["note-folders"] });
      }

      // If a collection-modifying tool ran, dispatch a refresh event
      if (
        collectionId &&
        data.tool_results?.some((tr: any) => COLLECTION_MODIFYING_TOOLS.includes(tr.tool))
      ) {
        window.dispatchEvent(
          new CustomEvent("menerio:collection-updated", { detail: { collectionId } }),
        );
      }

      setFiles([]);
      deliver(sentKey, sentUserId, sentContext, updated);
      summarizeLater(chatFn, sentKey, sentUserId, sentContext, updated);

      triggerCreditsRefresh();
    } catch (err: any) {
      // The error belongs to the conversation that asked; do not show it in another.
      if (chatKeyRef.current === sentKey){setError(stoppedRef.current?"Reply stopped.":err.message || "Something went wrong");if(!stoppedRef.current)setInput(prev=>prev||text);}
    } finally {
      setIsLoading(false);requestRef.current=null;
    }
  }, [input, files, model, effort, isLoading, session, state, noteId, personId, collectionId, collectionItemId, queryClient, chatKey, contextKey, user?.id, deliver, summarizeLater]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends; Shift+Enter inserts a newline. This matches the in-note and
    // Mira chats and the usual convention (ChatGPT/Claude/etc.). Cmd/Ctrl+Enter
    // still sends too, since it has no Shift - so the old shortcut keeps working.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = async () => {
    if (!(await confirm({ title: "Clear this conversation?", description: "The messages are removed from this chat. Changes already made to your data stay.", confirmLabel: "Clear", destructive: true }))) return;
    clearChatState(user?.id, contextKey);
    setState({ messages: [], summary: "", summarizedUpTo: 0 });
    setError(null);
  };

  if (!user) return null;

  const emptyText = collectionId
    ? "Ask me to add, update, or search items in this collection."
    : noteId
    ? "Ask me about this note or your knowledge base."
    : personId
      ? "Ask me about this person or anything in your knowledge base."
      : "Ask me anything about your notes, people, and media.";

  // Dimensions per mode
  const isLarge = page || effectiveMode !== "docked";
  const panelStyle: React.CSSProperties =
    page ? {height:"calc(100dvh - 104px)",minHeight:400,width:"100%"} : effectiveMode === "fullscreen"
      ? {
          top: 16,
          right: 16,
          bottom: 16,
          left: 16,
          width: "auto",
          height: "auto",
        }
      : effectiveMode === "expanded"
        ? {
            bottom: 24,
            right: 24,
            width: "min(720px, calc(100vw - 48px))",
            height: "min(85dvh, calc(100dvh - 80px))",
          }
        : {
            bottom: 24,
            right: 24,
            width: isMobile ? "calc(100vw - 24px)" : "min(420px, calc(100vw - 48px))",
            height: "min(560px, calc(100dvh - 80px))",
          };

  return (
    <>
      {/* FAB button */}
      {!page && !open && (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center justify-center",
            "h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg",
            "hover:bg-primary/90 transition-all hover:scale-105 active:scale-95",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
          )}
          title="Chat with Godspeed (Ctrl+Shift+K)"
          aria-label="Chat with Godspeed"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {/* Optional backdrop in fullscreen for focus */}
      {!page && open && effectiveMode === "fullscreen" && (
        <div
          className="fixed inset-0 z-40 bg-background/40 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setSizeMode(isMobile ? "docked" : "expanded")}
        />
      )}

      {/* Docked / expanded / fullscreen panel */}
      {open && (
        <div
          className={page ? "relative mx-auto max-w-5xl" : "fixed z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"}
          style={panelStyle}
        >
          <div className={page?"overflow-hidden flex flex-col h-full w-full":"bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full w-full"}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {noteId ? "Godspeed  /  Current note" : "Godspeed"}
                </span>
                {state.messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                     /  {state.messages.length} msgs{state.summary ? "  /  summary" : ""}
                  </span>
                )}
              </div>
              {page&&<Button variant="ghost" className="h-11" onClick={handleClear} disabled={isLoading}>Clear conversation</Button>}
              {!page&&<div className="flex items-center gap-1">
                <a className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-muted" href={'/dashboard/chat'+(noteId?'?note='+encodeURIComponent(noteId):personId?'?person='+encodeURIComponent(personId):'')} target="_blank" rel="noreferrer" aria-label="Open chat in a new window" title="Open chat in a new window"><ExternalLink className="h-4 w-4"/></a>
                <span className="text-[10px] text-muted-foreground hidden sm:inline mr-1">Ctrl+Shift+K</span>
                {state.messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleClear}
                    title="Clear conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {!isMobile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setSizeMode(effectiveMode === "docked" ? "expanded" : "docked")}
                    title={effectiveMode === "docked" ? "Expand" : "Collapse"}
                  >
                    {effectiveMode === "docked" ? (
                      <Maximize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Minimize2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    setSizeMode(
                      effectiveMode === "fullscreen" ? (isMobile ? "docked" : "expanded") : "fullscreen",
                    )
                  }
                  title={effectiveMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
                >
                  {effectiveMode === "fullscreen" ? (
                    <Shrink className="h-3.5 w-3.5" />
                  ) : (
                    <Expand className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} title="Close">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>}
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              onScroll={()=>{const el=scrollRef.current;if(el)followRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}
              className={cn(
                "flex-1 overflow-y-auto min-h-0 space-y-6",
                isLarge ? "px-5 py-4" : "p-3",
              )}
            >
              {state.messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-12 space-y-3">
                  <Bot className="h-8 w-8 mx-auto opacity-40" />
                  <h2 className="text-xl font-semibold text-foreground">What would you like to work on?</h2><p>{emptyText}</p>
                  <p className="text-[10px]">
                    Attach a document or image, or ask about a note. Your conversations are saved here.
                  </p>
                </div>
              )}

              {state.messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "bg-muted text-foreground max-w-[85%]"
                        : cn(
                            "bg-transparent",
                            isLarge ? "max-w-[85%] md:max-w-[75ch]" : "max-w-[85%]",
                          ),
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Suspense fallback={<div><p className="whitespace-pre-wrap">{msg.content}</p>{msg.attachments?.map(file=><a key={file.path} className="block text-xs underline mt-2" href={"/api/media/file/"+encodeURIComponent(file.path)} target="_blank" rel="noreferrer">{file.name}</a>)}</div>}>
                          <ChatMarkdown>{msg.content}</ChatMarkdown>
                        </Suspense>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}

                    {msg.toolResults && msg.toolResults.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                        {msg.toolResults.map((tr, j) => (
                          <div
                            key={j}
                            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                          >
                            <Wrench className="h-3 w-3" />
                            <span className="font-mono">
                              {tr.tool.replace(/_/g, " ")}
                            </span>
                            {(tr.result as any)?.success && (
                              <span className="text-primary">Saved</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.notesCreated && msg.notesCreated.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                        {msg.notesCreated.map((n) => (
                          <Link
                            key={n.id}
                            to={`/dashboard/notes/${n.id}`}
                            onClick={() => isMobile && setOpen(false)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {n.title || "Untitled"}
                              {n.folder_path ? `  /  ${n.folder_path}` : ""}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary shrink-0" />
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 pt-3 pb-1 px-1">
              <ChatComposer value={input} onChange={setInput} onSend={sendMessage} onStop={stopReply} busy={isLoading} files={files} onFiles={setFiles} model={model} effort={effort} onModel={setModel} onEffort={setEffort} reply={state.messages.filter(m=>m.role==='assistant').at(-1)?.content||''} context={noteId?'Current note: '+(contextTitle||'Loading...'):personId?'Current person: '+(contextTitle||'Loading...'):collectionId?'Current collection':'Your notebook / Relevant notes and people'} onError={setError}/>
              <p className="text-[11px] text-muted-foreground text-center pt-2">Enter to send · Shift+Enter for a new line</p>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
