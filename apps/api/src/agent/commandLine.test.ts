import { describe, expect, test } from "bun:test";
import { commandLine } from "./agent";

describe("commandLine", () => {
  // Real shape from the DB: a heredoc whose first line ends at the marker, then the whole file.
  test("keeps the first line and drops the heredoc body", () => {
    const cmd = "cd /home/user/react-template && cat > src/App.tsx <<'EOF'\nexport default function App() {\n  return <div/>\n}\nEOF";
    expect(commandLine(cmd)).toBe("cat > src/App.tsx <<'EOF'"); // cd prefix stripped, see below
  });

  test("caps a long single line — this rides in every SSE event and DB row", () => {
    const out = commandLine("cd /x && " + "a".repeat(500))!;
    expect(out.length).toBe(161); // 160 + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  test("a short command is untouched", () => {
    expect(commandLine("ls -la")).toBe("ls -la");
  });

  test("no command (ask_user) is undefined, not an empty row", () => {
    expect(commandLine(undefined)).toBeUndefined();
    expect(commandLine("")).toBeUndefined();
  });
});

// Every command already runs with cwd=WORKDIR (tools.ts), so the model's habitual `cd` there is
// redundant — 94% of 228 real commands carried it, eating 32 chars of every feed row.
describe("commandLine strips the redundant cd", () => {
  test("drops a leading cd into the workdir", () => {
    expect(commandLine("cd /home/user/react-template && ls -la")).toBe("ls -la");
  });

  test("works with the heredoc shape it usually appears in", () => {
    expect(commandLine("cd /home/user/react-template && cat > src/App.tsx <<'EOF'\nbody\nEOF"))
      .toBe("cat > src/App.tsx <<'EOF'");
  });

  // A cd somewhere else is real work and must survive.
  test("keeps a cd to any other directory", () => {
    expect(commandLine("cd src && ls")).toBe("cd src && ls");
    expect(commandLine("cd /tmp && ls")).toBe("cd /tmp && ls");
  });

  test("a bare cd into the workdir leaves nothing worth showing", () => {
    expect(commandLine("cd /home/user/react-template")).toBe("cd /home/user/react-template");
    expect(commandLine("cd /home/user/react-template && ")).toBeUndefined();
  });
});
