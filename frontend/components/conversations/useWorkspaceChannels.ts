"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isCurrentWorkspaceChannelChange,
  mergeWorkspaceChannelMessage,
  reconcileWorkspaceChannelChange,
  sortWorkspaceChannels,
  type WorkspaceChannelRealtimeChange,
} from "@/components/conversations/conversationUtils";
import { logClientError } from "@/lib/errors";
import { apiQueryOptions, omnixQueryKey } from "@/lib/query";
import type {
  WorkspaceChannel,
  WorkspaceChannelMessage,
} from "@/lib/workspace-types";

type ChannelUpdater = (
  current: WorkspaceChannel[],
) => WorkspaceChannel[];

type ChannelUpdateOptions = {
  revalidate?: boolean;
};

type DismissedChannelError = {
  endpoint: string;
  errorUpdatedAt: number;
};

const INACTIVE_CHANNEL_ENDPOINT = "/workspaces/inactive/channels";

export function useWorkspaceChannels(activeWorkspaceId: string | null) {
  const queryClient = useQueryClient();
  const [dismissedError, setDismissedError] =
    useState<DismissedChannelError | null>(null);
  const activeWorkspaceRef = useRef(activeWorkspaceId);
  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const endpoint = activeWorkspaceId
    ? `/workspaces/${activeWorkspaceId}/channels`
    : INACTIVE_CHANNEL_ENDPOINT;
  const queryKey = useMemo(() => omnixQueryKey(endpoint), [endpoint]);
  const channelsQuery = useQuery({
    ...apiQueryOptions<WorkspaceChannel[]>(endpoint),
    enabled: Boolean(activeWorkspaceId),
    select: sortWorkspaceChannels,
  });
  const refetchChannelsQuery = channelsQuery.refetch;

  useEffect(() => {
    if (!activeWorkspaceId || !channelsQuery.error) {
      return;
    }
    logClientError(
      "Failed to load workspace conversations",
      channelsQuery.error,
      { endpoint },
    );
  }, [
    activeWorkspaceId,
    channelsQuery.error,
    channelsQuery.errorUpdatedAt,
    endpoint,
  ]);

  const updateChannels = useCallback(async (
    updater: ChannelUpdater,
    options: ChannelUpdateOptions = {},
  ) => {
    if (!activeWorkspaceId) {
      return;
    }

    const requestWorkspaceId = activeWorkspaceId;
    const stateBeforeCancel = queryClient.getQueryState(queryKey);
    const shouldRevalidate =
      options.revalidate ||
      stateBeforeCancel?.data === undefined ||
      stateBeforeCancel.fetchStatus === "fetching";

    await queryClient.cancelQueries(
      { exact: true, queryKey },
      { silent: true },
    );
    if (activeWorkspaceRef.current !== requestWorkspaceId) {
      return;
    }

    queryClient.setQueryData<WorkspaceChannel[]>(
      queryKey,
      (current) => updater(current ?? []),
    );
    if (shouldRevalidate) {
      await queryClient.invalidateQueries({ exact: true, queryKey });
    }
  }, [activeWorkspaceId, queryClient, queryKey]);

  const applyRealtimeChange = useCallback((
    change: WorkspaceChannelRealtimeChange,
  ) => {
    if (
      !isCurrentWorkspaceChannelChange(
        change,
        activeWorkspaceId,
        activeWorkspaceRef.current,
      )
    ) {
      return;
    }
    const revalidate =
      change.eventType === "DELETE" || Boolean(change.new?.is_archived);
    void updateChannels(
      (current) => reconcileWorkspaceChannelChange(current, change),
      { revalidate },
    );
  }, [activeWorkspaceId, updateChannels]);

  const projectMessage = useCallback((
    message: WorkspaceChannelMessage,
  ) => {
    if (
      !message.workspace_id ||
      message.workspace_id !== activeWorkspaceRef.current
    ) {
      return;
    }
    void updateChannels(
      (current) => mergeWorkspaceChannelMessage(current, message),
    );
  }, [updateChannels]);

  const upsertChannel = useCallback((
    channel: WorkspaceChannel,
  ) => updateChannels(
    (current) => reconcileWorkspaceChannelChange(
      current,
      { eventType: "INSERT", new: channel },
    ),
  ), [updateChannels]);

  const refreshChannels = useCallback(async () => {
    setDismissedError(null);
    const result = await refetchChannelsQuery({ cancelRefetch: true });
    return result.data ?? [];
  }, [refetchChannelsQuery]);

  const dismissChannelsError = useCallback(() => {
    setDismissedError({
      endpoint,
      errorUpdatedAt: channelsQuery.errorUpdatedAt,
    });
  }, [channelsQuery.errorUpdatedAt, endpoint]);

  return {
    applyRealtimeChange,
    channels: channelsQuery.data ?? [],
    channelsError:
      channelsQuery.isError &&
      !(
        dismissedError?.endpoint === endpoint &&
        dismissedError.errorUpdatedAt === channelsQuery.errorUpdatedAt
      )
      ? "Unable to load conversations. Check your connection and try again."
      : null,
    channelsLoading: channelsQuery.isLoading,
    channelsRefreshing: channelsQuery.isFetching,
    channelsStale: channelsQuery.isStale,
    dismissChannelsError,
    projectMessage,
    refreshChannels,
    upsertChannel,
  };
}
