// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";
import {
  bindConnectionIdentity,
  readConnectionIdentity,
  rememberConnectionIdentity,
} from "./connection-identities";
import { updateSshTargets } from "./ssh-targets";

afterEach(() => localStorage.clear());

it("keeps the expected computer identity when an SSH alias gets a new tunnel port", () => {
  const expected = "74bcf65a-a849-4577-9a6f-c9b540940afb";
  const other = "2d0e29d5-3490-439d-a604-f51cc632551f";
  rememberConnectionIdentity("http://127.0.0.1:41234", expected, "ssh.work");
  rememberConnectionIdentity("http://127.0.0.1:42345", other, "ssh.other");
  updateSshTargets([
    {
      alias: "work",
      remotePort: 38886,
      url: "http://127.0.0.1:42345",
      state: "ready",
      error: null,
    },
  ]);
  expect(readConnectionIdentity("http://127.0.0.1:42345")).toBe(expected);
  expect(readConnectionIdentity("http://127.0.0.1:42345", "ssh.other")).toBe(
    other,
  );
  rememberConnectionIdentity("http://127.0.0.1:42345", other, "ssh.work");
  bindConnectionIdentity("http://127.0.0.1:43456", "ssh.work");
  expect(readConnectionIdentity("http://127.0.0.1:43456")).toBe(other);
});
