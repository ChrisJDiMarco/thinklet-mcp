# CDN-Based Full Renderer — Technical Design & Roadmap

## Problem Statement

The current direct renderer bundles React + sucrase + twind but **cannot render thinklets that use external libraries** (lucide-react, framer-motion, recharts, shadcn/ui). Since most real thinklets use these, the direct renderer only works for the simplest cases.

The iframe approach works with production URLs but **cannot reach localhost** from Claude's sandbox, blocking local development testing.

**Goal:** A direct renderer that supports the full component library by loading dependencies from CDN at runtime — no iframe, no localhost problem, works everywhere.

---

## How Content-App Renders (reference)

The content-app (`thinklet-content-app`) has a `ReactRenderer` component backed by a `ComponentSystem`:

### ComponentSystem Flow

```
1. detectComponents(code)
   - Regex-scans the code for component/hook names
   - Maps each name to a module (e.g., "SearchIcon" → "icons" module)
   - Returns a Set of required component names

2. prepareCodeWithCache(code, images)
   - cleanImports() — strips import/export statements
   - validateAndReplaceIcons() — fixes invalid icon names
   - transformResponsiveToContainer() — converts sm:/md:/lg: to @sm:/@md:/@lg:
   - addImagesToCode() — replaces IMAGE_ID:xxx with signed URLs

3. generateResolverCode(components)
   - Generates destructuring code for each detected module
   - Example: const { SearchIcon } = components.get('icons');

4. loadComponents(components)
   - Dynamically imports each required module
   - Modules are pre-bundled in the Next.js app
   - Returns a Map<moduleName, module>

5. Wrap + Transform + Eval
   - Wraps code in factory: (function createComponent(React, components) { ... })
   - Transforms JSX with sucrase
   - Evals and renders the resulting React component
```

### Module Registry (what content-app has pre-bundled)

| Module | Provides | NPM Package |
|--------|----------|-------------|
| framer | motion, AnimatePresence, useScroll, useTransform, useMotionValue | `framer-motion` |
| three | THREE | `three` |
| markdown | MarkdownRenderer | Custom component |
| useQuery | useQuery | `@tanstack/react-query` |
| useMutation | useMutation | `@tanstack/react-query` |
| useAIStreaming | useAIStreaming | Custom hook (platform) |
| useForm | useForm | `react-hook-form` |
| zodResolver | zodResolver | `@hookform/resolvers/zod` |
| zod | z | `zod` |
| lodash | debounce | `lodash` |
| useToast | useToast | Custom hook (platform) |
| useFileImport | useFileImport | Custom hook (platform) |
| useExport | useExport | Custom hook (platform) |
| icons | 200+ Lucide icons | `lucide-react` |
| recharts | All recharts components | `recharts` |
| aiApi | aiApi | Custom service (platform) |
| tql | TQL | Custom lib (platform) |
| shadcn/ui | Button, Card, Input, Label, Select, Dialog, Tabs, Badge, etc. | Custom components (radix-ui based) |

---

## CDN Renderer Design

### Core Idea

Replace the content-app's local `import()` calls with CDN `import()` calls to `esm.sh`:

```javascript
// Content-app (local bundle):
const framerModule = await import("framer-motion");

// CDN renderer (esm.sh):
const framerModule = await import("https://esm.sh/framer-motion@11");
```

`esm.sh` serves any npm package as ES modules. It handles dependencies, bundling, and caching.

### CSP Configuration

```typescript
registerAppResource(server, "Thinklet Viewer", VIEWER_RESOURCE_URI, {}, async () => ({
  contents: [{
    uri: VIEWER_RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: viewerHtml,
    _meta: {
      ui: {
        csp: {
          resourceDomains: ["https://esm.sh", "https://cdn.esm.sh"],
          connectDomains: ["https://esm.sh", "https://cdn.esm.sh"],
          frameDomains: [contentOrigin],
        }
      }
    }
  }]
}));
```

`resourceDomains` maps to `script-src` — enables dynamic `import()` from esm.sh.

### CDN Module Map

```typescript
const CDN_MODULES: Record<string, { url: string; provides: string[] }> = {
  framer: {
    url: "https://esm.sh/framer-motion@11",
    provides: ["motion", "AnimatePresence", "useScroll", "useTransform", "useMotionValue"],
  },
  three: {
    url: "https://esm.sh/three",
    provides: ["THREE"],
  },
  icons: {
    url: "https://esm.sh/lucide-react",
    provides: [...allLucideIconNames],
  },
  recharts: {
    url: "https://esm.sh/recharts",
    provides: ["LineChart", "BarChart", "PieChart", ...allRechartsComponents],
  },
  useForm: {
    url: "https://esm.sh/react-hook-form",
    provides: ["useForm"],
  },
  zodResolver: {
    url: "https://esm.sh/@hookform/resolvers/zod",
    provides: ["zodResolver"],
  },
  zod: {
    url: "https://esm.sh/zod",
    provides: ["z"],
  },
  lodash: {
    url: "https://esm.sh/lodash-es/debounce",
    provides: ["debounce"],
  },
  useQuery: {
    url: "https://esm.sh/@tanstack/react-query",
    provides: ["useQuery", "useMutation", "QueryClient", "QueryClientProvider"],
  },
};
```

### Rendering Flow (CDN version)

```
1. Receive thinklet code from structuredContent.code
   │
2. detectComponents(code)
   │  - Same regex-based detection as content-app
   │  - Returns Set<string> of component/hook names
   │
3. Resolve CDN modules
   │  - Map detected names → CDN_MODULES entries
   │  - Determine which esm.sh URLs to load
   │
4. Load from CDN (parallel)
   │  - const framer = await import("https://esm.sh/framer-motion@11");
   │  - const lucide = await import("https://esm.sh/lucide-react");
   │  - ... (all in Promise.all for parallelism)
   │
5. cleanImports(code)
   │  - Strip import/export statements
   │  - Replace export default with const Component =
   │
6. generateResolverCode(detectedComponents)
   │  - const { motion, AnimatePresence } = components.get('framer');
   │  - const { SearchIcon } = components.get('icons');
   │
7. Wrap + Transform + Eval
   │  - (function createComponent(React, components) { ... })
   │  - sucrase JSX transform
   │  - eval + factory(React, loadedModules)
   │
8. React.render(Component)
```

---

## What Can vs Cannot Be Supported

### Fully supported via CDN (npm packages)

| Library | Status | Notes |
|---------|--------|-------|
| lucide-react | ✅ | All icons available |
| framer-motion | ✅ | Full animation library |
| recharts | ✅ | All chart components |
| react-hook-form | ✅ | Form management |
| zod | ✅ | Schema validation |
| @hookform/resolvers/zod | ✅ | Zod resolver for react-hook-form |
| lodash | ✅ | debounce and other utils |
| three | ✅ | 3D rendering |
| @tanstack/react-query | ✅ | useQuery, useMutation |

### Partially supported (need stubs)

| Component | Status | Approach |
|-----------|--------|----------|
| shadcn/ui Button | ⚠️ | Build stub using Radix UI + Tailwind |
| shadcn/ui Card | ⚠️ | Build stub using div + Tailwind |
| shadcn/ui Input | ⚠️ | Build stub using native input + Tailwind |
| shadcn/ui Dialog | ⚠️ | Build stub using Radix Dialog + Tailwind |
| shadcn/ui Select | ⚠️ | Build stub using Radix Select + Tailwind |
| shadcn/ui Tabs | ⚠️ | Build stub using Radix Tabs + Tailwind |
| shadcn/ui Badge | ⚠️ | Build stub using span + Tailwind |
| shadcn/ui Label | ⚠️ | Build stub using label + Tailwind |
| MarkdownRenderer | ⚠️ | Use react-markdown from CDN |

These stubs would be bundled in the viewer (not loaded from CDN). They replicate the shadcn/ui API surface with simplified styling.

### Not supported (platform-specific)

| Feature | Status | Reason |
|---------|--------|--------|
| useAIStreaming | ❌ | Requires backend WebSocket connection |
| aiApi | ❌ | Requires backend API access |
| TQL (persistence) | ❌ | Requires backend state management |
| useFileImport | ❌ | Requires backend file upload |
| useExport | ❌ | Requires backend export service |
| useToast | ❌ | Could be stubbed with a simple notification |
| IMAGE_ID references | ❌ | Requires signed URLs from backend |

For unsupported features: the component will either show an error or the hook returns no-op stubs (e.g., `useAIStreaming` returns `{ content: "", isStreaming: false }`).

---

## Implementation Plan

### Phase 1: CDN Loading Infrastructure
- Add `resourceDomains` to CSP
- Build the CDN module map with esm.sh URLs
- Port `detectComponents()` from content-app to viewer
- Implement parallel CDN loading with `Promise.all`
- Wire into the existing `renderThinklet()` flow

### Phase 2: shadcn/ui Stubs
- Identify the most commonly used shadcn/ui components in thinklets
- Build lightweight Tailwind-styled stubs for each
- Bundle them in the viewer via Vite

### Phase 3: Platform Feature Stubs
- Create no-op stubs for `useAIStreaming`, `aiApi`, `TQL`, etc.
- Show user-friendly messages when these features are invoked ("Open the full app for AI features")

### Phase 4: Icon Validation
- Port the icon validation logic from ComponentSystem
- Handle invalid icon names gracefully (fallback to placeholder icon)

---

## Estimated Coverage

| Thinklet Type | Current (basic renderer) | After CDN renderer |
|---------------|-------------------------|-------------------|
| React + Tailwind only | ✅ Works | ✅ Works |
| Uses lucide icons | ❌ Crashes | ✅ Works |
| Uses framer-motion | ❌ Crashes | ✅ Works |
| Uses recharts | ❌ Crashes | ✅ Works |
| Uses shadcn/ui | ❌ Crashes | ⚠️ Works (styled differently) |
| Uses AI features | ❌ Crashes | ⚠️ Stubs (no actual AI) |
| Uses TQL persistence | ❌ Crashes | ⚠️ Stubs (no actual persistence) |

**Estimated: ~85-90% of thinklets render correctly (vs ~20% currently)**

---

## Performance Considerations

- **First load:** CDN imports add 1-3s latency (network fetch from esm.sh). Subsequent loads are cached by the browser/CDN.
- **Bundle size:** No increase — CDN modules aren't bundled, they're fetched on-demand.
- **esm.sh caching:** esm.sh uses aggressive caching headers. After first load, modules come from browser cache.

---

## Alternative: Production Iframe (simplest path)

If full fidelity is needed NOW without building the CDN renderer:

1. Set `THINKLET_CONTENT_URL=https://content.thinklet.io` in `.env`
2. The iframe approach gives 100% component support
3. The MCP server still runs locally (reaches local backend)
4. Only the viewer iframe points to production content-app

This is a valid production configuration. The CDN renderer is for when you want zero dependency on the content-app being deployed.
