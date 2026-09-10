import type { ThreadEvent } from "./provider-event.js";

export const KAIOKEN_THREAD_NAME_TAG = "kaioken";

interface TagThreadNameArgs {
  name: string;
  tag: string;
}

interface UntagThreadNameArgs {
  name: string;
  tag: string;
}

function threadNameTagPrefix(tag: string): string {
  return `[${tag}] `;
}

export function tagThreadName(args: TagThreadNameArgs): string {
  return `${threadNameTagPrefix(args.tag)}${args.name}`;
}

function untagThreadName(args: UntagThreadNameArgs): string {
  const prefix = threadNameTagPrefix(args.tag);
  if (!args.name.startsWith(prefix)) {
    return args.name;
  }
  return args.name.slice(prefix.length);
}

export function toProviderExternalThreadName(title: string): string {
  return tagThreadName({ name: title, tag: KAIOKEN_THREAD_NAME_TAG });
}

export function fromProviderExternalThreadName(name: string): string {
  return untagThreadName({ name, tag: KAIOKEN_THREAD_NAME_TAG });
}

export function normalizeProviderThreadNameEvent(
  event: ThreadEvent,
): ThreadEvent {
  if (event.type !== "thread/name/updated") {
    return event;
  }
  return {
    ...event,
    threadName: fromProviderExternalThreadName(event.threadName),
  };
}
