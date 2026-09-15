export function remoteThreadQueryKey(handle: string, threadId: string) {
  return ["federation", "thread", handle, threadId] as const;
}

export function remoteTimelineQueryKey(handle: string, threadId: string) {
  return ["federation", "timeline", handle, threadId] as const;
}

export function remotePendingInteractionsQueryKey(
  handle: string,
  threadId: string,
) {
  return ["federation", "pending-interactions", handle, threadId] as const;
}

export function remoteExecutionOptionsQueryKey(
  handle: string,
  threadId: string,
) {
  return ["federation", "execution-options", handle, threadId] as const;
}
