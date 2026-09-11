// Guest links (7c) — one reusable link per person you send it to:
//   bun run guest-link ["Recruiter, Acme"] [--steps 60] [--days 7]
//   bun run guest-link --list
//   bun run guest-link --revoke <id>
import { createGuestLink, listGuestLinks, revokeGuestLink } from "../src/admin/guests";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const num = (name: string) => (flag(name) === undefined ? undefined : Number(flag(name)));

try {
  if (args.includes("--list")) {
    const rows = await listGuestLinks();
    if (rows.length === 0) console.log("no guest links yet");
    for (const r of rows) {
      const state = r.revokedAt ? "revoked" : r.expiresAt.getTime() < Date.now() ? "expired" : "active";
      console.log(`${r.id}  ${state.padEnd(7)}  ${r.stepsUsed}/${r.stepsLimit ?? "∞"} steps  until ${r.expiresAt.toLocaleDateString()}  ${r.label ?? ""}`);
    }
  } else if (args.includes("--revoke")) {
    const id = flag("revoke");
    if (!id) throw new Error("usage: bun run guest-link --revoke <id>");
    console.log((await revokeGuestLink(id)) ? `revoked ${id}` : `no active link with id ${id}`);
  } else {
    const label = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
    const { url, id, expiresAt } = await createGuestLink({ steps: num("steps"), days: num("days"), label });
    console.log(`guest link ${id} (expires ${expiresAt.toLocaleString()}):\n${url}`);
  }
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
