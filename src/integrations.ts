/**
 * Platform integration catalog + condensed usage docs.
 *
 * Full docs live in thinklet-backend/common/services/prompts/library/shared/integrations/.
 * This file carries a compact version so the MCP server can serve them via
 * the `list_integrations` tool without bloating the base skill prompt.
 */

export interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  /** When the LLM should pick this integration based on user intent. */
  triggers: string[];
  /** Condensed usage reference returned when include_docs=true */
  docs: string;
}

export const INTEGRATIONS: Integration[] = [
  // ─── AI / LLM ───────────────────────────────────────────────────────────
  {
    id: "ai-api",
    name: "AI Streaming",
    category: "AI",
    description:
      "Stream LLM responses into the UI in real-time. Chat interfaces, content generation, summarization.",
    triggers: [
      "AI",
      "chat",
      "generate text",
      "summarize",
      "assistant",
      "LLM",
      "chatbot",
      "content generation",
    ],
    docs: `## AI Streaming Integration

Default to streaming for all AI interactions. Use non-streaming only when explicitly requested.

### Streaming (default)

\`\`\`jsx
import useAIStreaming from "@/hooks/use-ai-streaming";
import { MarkdownRenderer } from "@/components/markdown-renderer";

const { content, isStreaming, error, streamContent } = useAIStreaming({
  onComplete: (content) => console.log("Done:", content),
});

// Trigger on button click — NEVER auto-trigger
const handleGenerate = () => streamContent({ prompt });
// With model: streamContent({ prompt, model: "sonar" })
\`\`\`

### Non-Streaming (on request only)

\`\`\`jsx
import { aiApi } from "@/services/api/ai";
import { useMutation } from "@tanstack/react-query";

const { mutate: generateAI, data, isPending } = useMutation({
  mutationFn: aiApi.generate,
});
const handleGenerate = () => generateAI({ prompt });
\`\`\`

### Chat Interface Pattern

\`\`\`jsx
const { isStreaming, streamContent } = useAIStreaming({
  onStart: () => setMessages(prev => [...prev, { id: Date.now(), role: "assistant", content: "" }]),
  onChunk: (chunk, fullContent) => {
    setMessages(prev => prev.map((msg, i) =>
      i === prev.length - 1 && msg.role === "assistant" ? { ...msg, content: fullContent } : msg
    ));
  },
});
\`\`\`

### Hook API

\`\`\`typescript
const { content, isStreaming, error, isComplete, streamContent, cancelStream, resetState } = useAIStreaming({
  onStart?: () => void,
  onChunk?: (chunk: string, fullContent: string) => void,
  onComplete?: (fullContent: string) => void,
  onError?: (error: Error) => void,
});
\`\`\`

### Available Models
- \`sonar\` — deep research, web search, perplexity
- \`sonar-pro\` — more powerful sonar variant
- Omit \`model\` param to use the system default

### Rules
- ALWAYS require user click to trigger AI
- NEVER auto-trigger on mount or input change
- ALWAYS show loading/error states
- Default to streaming; use non-streaming only when explicitly requested`,
  },

  // ─── Image ──────────────────────────────────────────────────────────────
  {
    id: "image-generation",
    name: "Image Generation",
    category: "Media",
    description:
      "Generate images from text prompts, transform/edit uploaded images, analyze image content via AI.",
    triggers: [
      "image",
      "generate image",
      "picture",
      "photo",
      "illustration",
      "draw",
      "art",
      "visual",
      "thumbnail",
      "avatar",
    ],
    docs: `## Image Generation Integration

| Use Case | API | Returns |
|----------|-----|---------|
| Generate from text | \`aiApi.generateImage({ prompt })\` | \`string\` (URL) |
| Transform uploaded image | \`aiApi.analyzeImage({ imageUrl, prompt })\` | \`{ imageUrl }\` |
| Transform + show analysis | \`aiApi.analyzeImage({ imageUrl, prompt, includeAnalysis: true })\` | \`{ imageUrl, analysis }\` |
| Describe/analyze only | \`aiApi.analyzeImage({ imageUrl, generateImage: false })\` | \`string\` |

### Generate from Text

\`\`\`jsx
import { aiApi } from "@/services/api/ai";
import { useMutation } from "@tanstack/react-query";

const { mutate: generateImage, data: imageUrl, isPending } = useMutation({
  mutationFn: (params) => aiApi.generateImage(params),
});
const handleGenerate = () => generateImage({ prompt });
// imageUrl is a CDN URL string
\`\`\`

### Transform Uploaded Image

\`\`\`jsx
import { useFileImport } from "@/hooks/use-file-import";
const { files, uploadFile, isUploading } = useFileImport({ acceptedTypes: ["image/*"] });

const { mutate: transform, data: result } = useMutation({
  mutationFn: (params) => aiApi.analyzeImage(params),
});
// result.imageUrl — generated image
// result.analysis — if includeAnalysis: true
// result.warning — fallback warning for non-seed models (show as inline banner)
\`\`\`

### API Reference

\`\`\`typescript
aiApi.generateImage({ prompt: string }) // Returns: string (CDN URL)
aiApi.analyzeImage({
  imageUrl: string,              // Required
  prompt?: string,
  generateImage?: boolean,       // Default true
  includeAnalysis?: boolean,     // Default false
  model?: string,
  resolution?: string,           // "1K" | "2K" | "4K"
  quality?: string,              // "standard" | "hd"
})
\`\`\`

### Rules
- User action required (button click)
- Show loading/error states
- \`generateImage: true\` is default on analyzeImage
- Show fallback warning banner if result.warning is present`,
  },

  // ─── Video ──────────────────────────────────────────────────────────────
  {
    id: "video-generation",
    name: "Video Generation",
    category: "Media",
    description:
      "Generate AI videos from text prompts. Standard or pro quality, 5s or 10s duration.",
    triggers: [
      "video",
      "generate video",
      "animation",
      "clip",
      "film",
      "shorts",
      "motion",
    ],
    docs: `## Video Generation Integration

### CSS LIMITATIONS — CRITICAL
These classes DO NOT WORK in thinklet containers:
- \`w-full\` on video containers — width collapses to 0
- \`flex-1\` — cannot calculate width
- \`aspect-video\`, \`aspect-[9/16]\`, \`aspect-square\` — height fails
- \`lg:col-span-X\` — grid columns don't pass width

**EVERY container must have EXPLICIT pixel dimensions.**

### Required Layout

\`\`\`jsx
// Left column: lg:w-[350px] lg:flex-shrink-0
// Right column: lg:w-[700px] (NOT flex-1)
// Main player 16:9: w-[600px] h-[340px] max-w-full
// Main player 9:16: w-[340px] h-[600px] max-w-full
// Thumbnails: h-[120px]
\`\`\`

### API

\`\`\`jsx
import { aiApi } from "@/services/api/ai";
import { useMutation } from "@tanstack/react-query";

const { mutate: generateVideo, isPending } = useMutation({
  mutationFn: (params) => aiApi.generateVideo(params),
  onSuccess: (data) => {
    // data.videoUrl — CDN URL of generated video
  },
});

generateVideo({
  prompt: string,                              // Required
  quality?: "standard" | "pro",                // Default "standard"
  duration?: "5" | "10",                       // Default "5"
  aspectRatio?: "16:9" | "9:16" | "1:1",      // Default "16:9"
  imageUrl?: string,                           // For image-to-video
});
\`\`\`

### Video Player Pattern

\`\`\`jsx
<div className="w-[600px] h-[340px] max-w-full mx-auto bg-black rounded-xl overflow-hidden">
  <video src={video.url} controls autoPlay loop playsInline className="w-full h-full object-contain" />
</div>
\`\`\`

### Rules
- User action required (button click)
- Show loading state ("This takes 1-3 minutes")
- NO flex-1, NO w-full on video containers, NO aspect-* classes
- All containers need explicit pixel dimensions`,
  },

  // ─── Web Scraping ──────────────────────────────────────────────────────
  {
    id: "web-scraping",
    name: "Web Scraping",
    category: "Data",
    description:
      "Extract clean markdown content from any public web page. Summarize, analyze, or display web content.",
    triggers: [
      "scrape",
      "web",
      "URL",
      "extract",
      "fetch page",
      "website",
      "article",
      "read URL",
    ],
    docs: `## Web Scraping Integration

### API

\`\`\`jsx
import { aiApi } from "@/services/api/ai";
import { useMutation } from "@tanstack/react-query";

const { mutate: scrapeUrl, data: result, isPending } = useMutation({
  mutationFn: (params) => aiApi.scrapeUrl(params),
});

scrapeUrl({ url: "https://example.com/article" });
// result.markdown  — clean extracted content
// result.metadata  — { title, description, language, ... }
\`\`\`

### API Reference

\`\`\`typescript
aiApi.scrapeUrl({
  url: string,          // Required, must start with http:// or https://
  formats?: string[],   // Default ["markdown"]
})
// Returns: { markdown: string, metadata: Record<string, unknown>, html?: string, links?: string[] }
\`\`\`

### Combining with AI

\`\`\`jsx
const { mutate: scrapeAndSummarize } = useMutation({
  mutationFn: async ({ url }) => {
    const scraped = await aiApi.scrapeUrl({ url });
    const summary = await aiApi.generate({ prompt: \`Summarize:\\n\\n\${scraped.markdown}\` });
    return { scraped, summary };
  },
});
\`\`\`

### Rules
- Wrap in useMutation, require user action (button/form submit)
- Show loading/error states
- Only public HTTPS URLs — no localhost, private IPs
- NEVER auto-scrape on mount or input change`,
  },

  // ─── Audio ──────────────────────────────────────────────────────────────
  {
    id: "audio-generation",
    name: "Text to Speech",
    category: "Media",
    description:
      "Generate speech audio from text using ElevenLabs. Single voice or multi-voice podcast/dialogue.",
    triggers: [
      "audio",
      "speech",
      "TTS",
      "text to speech",
      "voice",
      "podcast",
      "narration",
      "read aloud",
    ],
    docs: `## Audio Generation Integration

### CRITICAL: BANNED API
\`aiApi.generateDialogueAudio()\` DOES NOT EXIST. NEVER use it.
For ALL audio (single, multi-voice, podcasts) use ONLY \`aiApi.generateAudio()\`.

### CSS LIMITATIONS
Same as video: NO \`flex-1\`, NO \`w-full\` on audio containers. Use explicit pixel widths.
- Left column: \`lg:w-[350px] lg:flex-shrink-0\`
- Right column: \`lg:w-[700px]\`

### Single Voice

\`\`\`jsx
import { aiApi } from "@/services/api/ai";
import { useMutation } from "@tanstack/react-query";

const { mutate: generateAudio, isPending } = useMutation({
  mutationFn: (params) => aiApi.generateAudio(params),
  onSuccess: (data) => {
    // data.audioUrl — CDN URL
    // data.voice, data.charCount, data.cost
  },
});

generateAudio({
  text: string,            // Required, max 5000 chars
  voice?: string,          // Default "Rachel"
  model?: string,          // Default "elevenlabs-tts-v3"
  stability?: number,      // 0-1, default 0.5
  languageCode?: string,   // ISO 639-1
});
\`\`\`

### Multi-Voice (Podcast)

Generate each speaker turn separately — NO batch endpoint:

\`\`\`jsx
const turns = [
  { text: "[excited] Welcome to the show!", voice: "Aria" },
  { text: "[laughs] Thanks for having me!", voice: "Roger" },
];
const audioUrls = [];
for (const turn of turns) {
  const result = await aiApi.generateAudio({ text: turn.text, voice: turn.voice });
  audioUrls.push(result.audioUrl);
}
// Play audioUrls sequentially via <audio> element
\`\`\`

### Available Voices
Female: Rachel, Aria, Sarah, Charlotte, Laura, Alice, Matilda, Lily, Jessica
Male: Roger, Daniel, Charlie, George, Liam, Callum, River, Will, Eric, Chris, Brian, Bill

### Audio Tags (inline expressions)
Emotions: \`[excited]\` \`[curious]\` \`[sarcastic]\` \`[calm]\` \`[warmly]\` \`[dramatically]\`
Reactions: \`[laughs]\` \`[sighs]\` \`[gasps]\` \`[whispers]\` \`[shouts]\`
Punctuation: \`...\` (pauses), \`CAPS\` (emphasis), \`!\` \`?\` (intonation)

### Rules
- NEVER call generateDialogueAudio — it doesn't exist
- User action required (button click)
- Max 5000 chars per request
- Voice names are case-sensitive ("Rachel" not "rachel")
- For podcasts, generate each turn separately`,
  },

  // ─── Perplexity Research ───────────────────────────────────────────────
  {
    id: "perplexity-research",
    name: "Perplexity Research",
    category: "AI",
    description:
      "AI-powered deep research and web search via Perplexity models (sonar, sonar-pro).",
    triggers: [
      "research",
      "deep search",
      "perplexity",
      "web search",
      "look up",
      "find information",
    ],
    docs: `## Perplexity Research

Uses the AI Streaming integration with Perplexity models for web-grounded research.

\`\`\`jsx
import useAIStreaming from "@/hooks/use-ai-streaming";

const { content, isStreaming, streamContent } = useAIStreaming({});

// Use sonar for web search / research
const handleResearch = () => streamContent({ prompt, model: "sonar" });

// Use sonar-pro for deeper research
const handleDeepResearch = () => streamContent({ prompt, model: "sonar-pro" });
\`\`\`

This is effectively the AI Streaming integration with the \`model\` parameter set to a Perplexity model.
All AI Streaming rules apply.`,
  },
];

/** Return the compact catalog (no docs). */
export function getCatalog() {
  return INTEGRATIONS.map(({ id, name, category, description, triggers }) => ({
    id,
    name,
    category,
    description,
    triggers,
  }));
}

/** Return full docs for specific integration IDs. */
export function getIntegrationDocs(ids: string[]): string {
  const selected = INTEGRATIONS.filter((i) => ids.includes(i.id));
  if (selected.length === 0) return "No matching integrations found.";

  return selected
    .map((i) => `# ${i.name} (${i.id})\n\n${i.docs}`)
    .join("\n\n---\n\n");
}

export interface MatchedIntegration {
  id: string;
  name: string;
  description: string;
  matchedTriggers: string[];
}

/**
 * Match a user query against integration triggers. Returns integrations
 * whose triggers appear as substrings in the query (case-insensitive).
 * Sorted by number of matched triggers descending.
 */
export function matchTriggers(query: string): MatchedIntegration[] {
  const lower = query.toLowerCase();
  const matches: MatchedIntegration[] = [];

  for (const integration of INTEGRATIONS) {
    const hit = integration.triggers.filter((t) => lower.includes(t.toLowerCase()));
    if (hit.length > 0) {
      matches.push({
        id: integration.id,
        name: integration.name,
        description: integration.description,
        matchedTriggers: hit,
      });
    }
  }

  return matches.sort((a, b) => b.matchedTriggers.length - a.matchedTriggers.length);
}
