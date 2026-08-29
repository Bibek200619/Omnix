"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WifiOff } from "lucide-react";
import { ChatHistoryPanel } from "@/components/chat/ChatHistoryPanel";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWorkspaceChrome } from "@/components/chat/ChatWorkspaceChrome";
import { MessageList } from "@/components/chat/MessageList";
import type { SearchMode } from "@/components/chat/types";
import {
  currentUserNameFromSession,
  type SenderLookup,
  useChatMessages,
} from "@/components/chat/useChatMessages";
import { useChatStream } from "@/components/chat/useChatStream";
import { useChatSync } from "@/components/chat/useChatSync";
import { Alert } from "@/components/ui/Alert";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useProfile } from "@/lib/profile-context";
import { recoverableDraftKey } from "@/lib/recoverable-draft";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceIntelligence } from "@/lib/workspace-intelligence-context";
import { useWorkspaceMembership } from "@/lib/workspace-membership-context";
import { useWorkspaceTree } from "@/lib/workspace-tree-context";
import { initialsFromText } from "@/lib/workspace-roles";
import type { WorkspaceMember } from "@/lib/workspace-types";

export function ChatInterface() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { activeMembers, refreshActiveWorkspaceData } = useWorkspaceMembership();
  const { activeWorkspaceIntelligence } = useWorkspaceIntelligence();
  const {
    activeConversationId,
    conversations,
    refreshConversations,
    setActiveConversation,
  } = useConversationHistory();
  const {
    presence,
    typingUsers,
    sendTypingSignal,
    statusForWorkspace,
  } = useWorkspaceCollaboration();
  const conversationId = params.get("conversation");
  const authenticatedUserId = user?.id ?? null;
  const [searchMode, setSearchMode] = useState<SearchMode>("auto");
  const [historyOpen, setHistoryOpen] = useState(true);

  const workspaceMembers = useMemo(
    () => (activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? []),
    [activeMembers, activeWorkspace?.members_preview],
  );
  const activeLiveStatus = statusForWorkspace(activeWorkspaceId);

  const senderLookup = useMemo<SenderLookup>(() => {
    const membersById = new Map<string, WorkspaceMember>();
    for (const member of workspaceMembers) membersById.set(member.user_id, member);

    return {
      currentUserId: user?.id ?? null,
      currentUserEmail: user?.email ?? null,
      currentUserName: profile?.display_name || currentUserNameFromSession(user?.email ?? null, user?.user_metadata),
      currentUserHandle: profile?.username ?? profile?.handle ?? null,
      currentUserAvatarUrl: profile?.avatar_url ?? null,
      currentUserWorkspaceRole: activeWorkspace?.current_user_role ?? "member",
      membersById,
    };
  }, [
    activeWorkspace?.current_user_role,
    profile?.avatar_url,
    profile?.display_name,
    profile?.handle,
    profile?.username,
    user?.email,
    user?.id,
    user?.user_metadata,
    workspaceMembers,
  ]);

  const chatMessages = useChatMessages({
    activeWorkspaceId,
    conversationId,
    refreshConversations,
    router,
    senderLookup,
    setActiveConversation,
  });
  const respondingRef = useRef(false);

  const { reconcileConversationMessages } = useChatSync({
    authenticatedUserId,
    currentConversationRef: chatMessages.currentConversationRef,
    lastMessageSyncRef: chatMessages.lastMessageSyncRef,
    mountedRef: chatMessages.mountedRef,
    refreshActiveWorkspaceData,
    respondingRef,
    senderLookupRef: chatMessages.senderLookupRef,
    setError: chatMessages.setError,
    setMessages: chatMessages.setMessages,
  });

  const chatStream = useChatStream({
    activeWorkspaceId,
    activeWorkspaceRole: activeWorkspace?.current_user_role,
    conversationId,
    currentConversation: chatMessages.currentConversation,
    currentConversationRef: chatMessages.currentConversationRef,
    messagesRef: chatMessages.messagesRef,
    mountedRef: chatMessages.mountedRef,
    pendingAttachments: chatMessages.pendingAttachments,
    reconcileConversationMessages,
    refreshConversations,
    respondingRef,
    router,
    searchMode,
    senderLookup,
    setActiveConversation,
    setCurrentConversation: chatMessages.setCurrentConversation,
    setCurrentConversationWorkspaceId: chatMessages.setCurrentConversationWorkspaceId,
    setError: chatMessages.setError,
    setMessages: chatMessages.setMessages,
    setPendingAttachments: chatMessages.setPendingAttachments,
    userEmail: user?.email,
    userId: user?.id,
  });

  const conversationTypingMembers = useMemo(() => {
    return Object.values(typingUsers)
      .filter((signal) => {
        if (signal.userId === user?.id) return false;
        if (!chatMessages.currentConversation) return true;
        return !signal.conversationId || signal.conversationId === chatMessages.currentConversation;
      })
      .map((signal) => ({
        user_id: signal.userId,
        full_name: signal.fullName,
        avatar_url: signal.avatarUrl,
        avatar_label: initialsFromText(signal.fullName),
        is_typing: true,
        workspace_id: activeWorkspaceId || "",
        status: "online" as const,
        is_online: true,
      }));
  }, [activeWorkspaceId, chatMessages.currentConversation, typingUsers, user?.id]);

  const visibleHistory = conversations.slice(0, 7);
  const activeHistoryItem = visibleHistory.find((item) => item.id === activeConversationId) ?? visibleHistory[0];
  const chatDraftStorageKey = useMemo(
    () => recoverableDraftKey([
      "chat",
      user?.id ?? "anonymous",
      activeWorkspaceId ?? "no-workspace",
      chatMessages.currentConversation || conversationId || "new",
    ]),
    [activeWorkspaceId, chatMessages.currentConversation, conversationId, user?.id],
  );

  return (
    <section className="relative flex h-full w-full overflow-hidden bg-[var(--omnix-bg)] text-[var(--omnix-text)]">
      <LiveRegion message={chatStream.streamAnnouncement} />
      <div className="pointer-events-none absolute left-[18%] top-[-18%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,var(--omnix-rgba-0-255-255-0-075),transparent_68%)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[4%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--omnix-rgba-0-51-255-0-085),transparent_70%)] blur-3xl" />
      <ChatHistoryPanel
        activeHistoryItem={activeHistoryItem}
        historyOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenConversation={(id) => {
          setActiveConversation(id);
          router.push(`/chat?conversation=${id}`, { scroll: false });
        }}
        onStartNew={() => router.push("/chat")}
        visibleHistory={visibleHistory}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatWorkspaceChrome
          activeLiveStatus={activeLiveStatus}
          activeWorkspace={activeWorkspace}
          activeWorkspaceIntelligence={activeWorkspaceIntelligence}
          currentConversation={chatMessages.currentConversation}
          currentUserId={user?.id}
          historyOpen={historyOpen}
          onOpenHistory={() => setHistoryOpen(true)}
          presence={presence}
          searchMode={searchMode}
          workspaceMembers={workspaceMembers}
        />

        {chatMessages.error ? (
          <div className="px-4 pt-4">
            <Alert variant="error" title="Omnix could not complete the request" className="items-start">
              <span className="inline-flex items-start gap-2">
                <WifiOff className="mt-1 h-3.5 w-3.5 shrink-0" />
                {chatMessages.error}
              </span>
            </Alert>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageList
            key={`${activeWorkspaceId}-${chatMessages.currentConversation || "new"}`}
            messages={chatMessages.messages}
            loading={chatStream.responding}
            loadingConversation={chatMessages.loadingConversation}
            typingMembers={conversationTypingMembers}
            onRetry={chatStream.handleRetry}
            onRegenerate={chatStream.handleRegenerate}
          />
          <div className="shrink-0 bg-gradient-to-t from-[var(--omnix-bg)] via-[var(--omnix-rgba-5-12-23-0-94)] to-transparent px-2.5 pb-2.5 pt-3 sm:px-[22px] sm:pb-[18px] sm:pt-10">
            <ChatInput
              onSend={chatStream.sendMessage}
              loading={chatStream.responding}
              onCancel={chatStream.cancelStream}
              conversationId={chatMessages.currentConversation || undefined}
              attachments={chatMessages.pendingAttachments}
              searchMode={searchMode}
              onSearchModeChange={setSearchMode}
              onUploadSuccess={chatMessages.handleUploadSuccess}
              onRemoveAttachment={chatMessages.handleRemoveAttachment}
              draftStorageKey={chatDraftStorageKey}
              onTypingChange={(isTyping) => {
                void sendTypingSignal(chatMessages.currentConversationRef.current, isTyping);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
