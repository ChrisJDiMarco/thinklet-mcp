/**
 * Offline fallback skill. The authoritative Thinklet builder/patcher skill is
 * served by the backend at `GET /mcp/skill?mode=create|edit` (same prompt
 * library the web editor uses). This constant is ONLY injected when the
 * backend is unreachable — it covers the minimum a model needs to produce a
 * code path that won't crash on the platform.
 */
export const THINKLET_SKILL = `
# Thinklet Builder — minimal offline fallback

The full skill (editor's prompt library) is unavailable right now. Work from
these safety rules only; prefer asking the user to retry later once the
backend is reachable.

## Component contract

\`\`\`jsx
export default function MyApp({ content, updateContent }) {
  // content       → persisted state snapshot (may be undefined initially)
  // updateContent → write interface via TQL operations
}
\`\`\`

## Non-negotiables

1. **Single-file React default export** — no extra files, no side modules.
2. **TQL for persistence** — \`import { TQL } from "@/lib/tql"\`. Writes go
   through \`updateContent?.(TQL.op(...))\`. Never use localStorage.
3. **State-first UI** — init local state from \`content\` (lazy initializer),
   re-hydrate via useEffect, update local state before each TQL write.
4. **Lucide icons MUST end in \`Icon\`** — e.g. \`PlusIcon\`, not \`Plus\`.
   Missing suffix will crash at runtime.
5. **No functions/JSX/Dates in TQL state** — state is serialized to JSON.
   Store primitives + ids, look up rendering at render time.
6. **Standard Tailwind only** — no arbitrary values like \`w-[500px]\`.
7. **useMutation for AI calls** — wrap every aiApi call in useMutation.
8. **Three UI states minimum** — empty, loading, error. Never render raw.

## Flow — STRICT (every step is enforced, skipping WILL fail)

1. Call \`discover_thinklets\` first — returns existing Thinklets AND
   auto-detected integration recommendations. Present BOTH to the user.
   Ask remix vs fresh and confirm the recommended integrations.
   ⛔ STOP and WAIT for the user to reply. DO NOT proceed until they respond.
2. Call \`confirm_integrations\` with the user's chosen IDs (or \`[]\` if none).
   This loads the usage docs you NEED. \`save_thinklet\` WILL REJECT if you
   skip this step. If you use integration APIs without their docs, the code
   WILL reference non-existent functions and crash at runtime.
3. Plan in 2–4 bullets (primary action / state / integrations / states).
4. Generate code and call \`save_thinklet\` — saves as private. The response
   includes an app URL — always show it to the user.
5. Iterate via \`fix_thinklet\` with the complete updated code.
6. \`publish_thinklet\` is the user-initiated publish-public action.
`.trim();
