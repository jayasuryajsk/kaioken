import { describe, expect, it } from "vitest";
import {
  BOARD_IDEA_MAX_LENGTH,
  boardIdeaTitle,
  createBoardIdea,
  removeBoardIdea,
} from "./board-ideas";

describe("board ideas", () => {
  it("trims, caps, and rejects blank ideas", () => {
    expect(createBoardIdea("   ", "proj_1")).toBeNull();
    const idea = createBoardIdea(
      `  ${"x".repeat(BOARD_IDEA_MAX_LENGTH + 5)}  `,
      "proj_1",
      7,
    );
    expect(idea?.text).toHaveLength(BOARD_IDEA_MAX_LENGTH);
    expect(idea?.projectId).toBe("proj_1");
    expect(idea?.createdAt).toBe(7);
  });

  it("gives every idea its own id and removes by id", () => {
    const first = createBoardIdea("fix login", "proj_1", 1);
    const second = createBoardIdea("fix login", "proj_1", 1);
    expect(first?.id).not.toBe(second?.id);
    expect(removeBoardIdea([first!, second!], first!.id)).toEqual([second]);
  });

  it("uses the first line as the card title, shortened", () => {
    expect(boardIdeaTitle("fix login\nmore detail")).toBe("fix login");
    expect(boardIdeaTitle("a".repeat(100))).toHaveLength(80);
  });
});
