import { atomWithStorage } from "jotai/utils";

export const BOARD_IDEAS_STORAGE_KEY = "bb.board.ideas";
export const BOARD_IDEA_MAX_LENGTH = 4000;

export interface BoardIdea {
  id: string;
  text: string;
  projectId: string;
  createdAt: number;
}

export const boardIdeasAtom = atomWithStorage<BoardIdea[]>(
  BOARD_IDEAS_STORAGE_KEY,
  [],
);

export function createBoardIdea(
  text: string,
  projectId: string,
  now: number = Date.now(),
): BoardIdea | null {
  const trimmed = text.trim().slice(0, BOARD_IDEA_MAX_LENGTH);
  if (trimmed.length === 0) {
    return null;
  }
  return {
    id: `idea_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
    projectId,
    createdAt: now,
  };
}

export function removeBoardIdea(
  ideas: readonly BoardIdea[],
  ideaId: string,
): BoardIdea[] {
  return ideas.filter((idea) => idea.id !== ideaId);
}

export function boardIdeaTitle(text: string): string {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}
