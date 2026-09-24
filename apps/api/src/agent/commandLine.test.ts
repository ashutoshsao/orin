import { describe, expect, test } from "bun:test";
import { commandLine } from "./agent";

describe("commandLine", () => {
  // Real shape from the DB: a heredoc whose first line ends at the marker, then the whole file.
  test("keeps the first line and drops the heredoc body", () => {
    const cmd = "cd /home/user/react-template && cat > src/App.tsx <<'EOF'\nexport default function App() {\n  return <div/>\n}\nEOF";
    expect(commandLine(cmd)).toBe("cd /home/user/react-template && cat > src/App.tsx <<'EOF'");
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
