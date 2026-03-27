/**
 * Thinklet Builder Skill — injected as an MCP prompt so Claude knows
 * exactly how to generate production-correct Thinklet code.
 */
export const THINKLET_SKILL = `
# Thinklet App Builder

You are building a Thinklet — a browser-native, AI-powered interactive tool.
Every Thinklet is a single default-exported React component with this exact contract:

\`\`\`jsx
export default function MyApp({ content, updateContent }) {
  // content       → persisted state snapshot (may be undefined initially)
  // updateContent → write interface via TQL operations
}
\`\`\`

## State Pattern (always use all three parts)

\`\`\`jsx
// 1. Initialize from persisted content
const [items, setItems] = useState(() => content?.items || []);

// 2. Sync when content updates
useEffect(() => { setItems(content?.items || []); }, [content?.items]);

// 3. Write back via TQL (always optional-chain updateContent)
updateContent?.(TQL.push("items", newItem));
\`\`\`

## TQL — Persistence API

Import: \`import { TQL } from "@/lib/tql"\`

| Operation | Usage |
|-----------|-------|
| \`TQL.set(key, value)\` | Set a top-level key |
| \`TQL.push(key, item)\` | Append to array |
| \`TQL.pull(key, id)\` | Remove by id |
| \`TQL.updateOne(key, id, patch)\` | Update one item in array |
| \`TQL.batch([...ops])\` | Multiple ops atomically |
| \`TQL.increment(key, n)\` | Increment a number |
| \`TQL.toggle(key)\` | Boolean toggle |
| \`TQL.move(key, fromIdx, toIdx)\` | Reorder array |
| \`TQL.merge(key, patch)\` | Shallow merge object |
| \`TQL.sort(key, field, dir)\` | Sort array |
| \`TQL.addUnique(key, item)\` | Push if not present |
| \`TQL.conditional(condition, op)\` | Conditional op |

## Custom Hooks

\`\`\`jsx
import { useAIStreaming } from "@/hooks/use-ai-streaming";
import { useExport } from "@/hooks/use-export";
import { useFileImport } from "@/hooks/use-file-import";
import { useToast } from "@/hooks/use-toast";
\`\`\`

- \`useAIStreaming({ prompt, onChunk, onDone })\` → streaming LLM responses
- \`useExport(data, filename)\` → returns \`{ exportCSV, exportJSON }\`
- \`useFileImport({ onImport, accept })\` → returns \`{ open, FileInput }\`
- \`useToast()\` → returns \`{ toast }\` — call \`toast({ title, description, variant })\`

## Custom Components

\`\`\`jsx
import { MarkdownRenderer } from "@/components/markdown-renderer";
// <MarkdownRenderer content={markdownString} />
\`\`\`

## Platform Globals — NEVER redefine these, they are injected

- \`useMutation\`, \`useQuery\` — data layer hooks
- \`motion\`, \`AnimatePresence\` — from framer-motion
- React hooks: \`useState\`, \`useEffect\`, \`useRef\`, \`useCallback\`, \`useMemo\`

## Icon Rule — CRITICAL

ALL lucide-react icons MUST have the \`Icon\` suffix:
- ✅ \`import { Trash2Icon, PlusIcon, CheckIcon } from "lucide-react"\`
- ❌ \`import { Trash2, Plus, Check } from "lucide-react"\` — WILL CRASH

## Serialization Rule — CRITICAL

Never store React components, functions, or class instances in TQL-persisted state.
TQL state is serialized to JSON. Functions cannot be serialized.

- ❌ \`{ icon: Building2Icon }\` → crashes on reload
- ✅ \`{ type: "agency" }\` → look up the icon at render time

## Design System

Use Tailwind for all styling. Thinklet apps should feel polished:
- Dark mode preferred: \`bg-zinc-900\`, \`text-zinc-100\`
- Cards: \`bg-zinc-800 rounded-xl p-4\`
- Accent: indigo/violet — \`bg-indigo-600\`, \`text-indigo-400\`
- Animations: use \`motion.div\` with \`initial/animate/exit\` for list items

## Complete Example

\`\`\`jsx
import { useState, useEffect } from "react";
import { TQL } from "@/lib/tql";
import { PlusIcon, Trash2Icon } from "lucide-react";

export default function TaskList({ content, updateContent }) {
  const [tasks, setTasks] = useState(() => content?.tasks || []);
  const [input, setInput] = useState("");

  useEffect(() => { setTasks(content?.tasks || []); }, [content?.tasks]);

  const addTask = () => {
    if (!input.trim()) return;
    const task = { id: Date.now(), text: input, done: false };
    setTasks(prev => [...prev, task]);
    updateContent?.(TQL.push("tasks", task));
    setInput("");
  };

  const toggleTask = (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
    const task = tasks.find(t => t.id === id);
    updateContent?.(TQL.updateOne("tasks", id, { done: !task.done }));
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Task List</h1>
      <div className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          className="flex-1 bg-zinc-800 rounded-lg px-4 py-2 outline-none"
          placeholder="Add a task..."
        />
        <button onClick={addTask} className="bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2">
          <PlusIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="space-y-2">
        {tasks.map(task => (
          <div key={task.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg px-4 py-3">
            <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
            <span className={task.done ? "line-through text-zinc-500" : ""}>{task.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
\`\`\`
`.trim();
