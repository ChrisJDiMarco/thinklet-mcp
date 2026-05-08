import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import React from "react";
import { createRoot } from "react-dom/client";
import { transform } from "sucrase";
import { install, observe } from "@twind/core";
import presetTailwind from "@twind/preset-tailwind";

const tw = install({ presets: [presetTailwind()] });
observe(tw, document.documentElement);

const rootEl = document.getElementById("root") as HTMLDivElement;
const loading = document.getElementById("loading") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;

// ─── Day 1 Inline-Shim Feasibility Spike ───────────────────────────────────
// Toggle to true (and rebuild) to re-run feasibility checks. All three checks
// passed on 2026-05-05 against prod api.thinklet.io after CORS deploy.
// Kept in source for future re-verification if Claude Desktop CSP changes.
const SPIKE_ENABLED = false;

async function runSpike() {
  console.log("%c[spike] === Day 1 inline-shim feasibility checks ===", "font-weight:bold");
  console.log("[spike] host:", location.href);
  console.log("[spike] origin:", location.origin);

  // Check 1 — connect-src to api.thinklet.io
  try {
    const r = await fetch("https://api.thinklet.io/health", { method: "GET" });
    console.log(`%c[spike] 1/3 connect-src api.thinklet.io: PASS (status=${r.status})`, "color:green");
  } catch (e) {
    console.error("%c[spike] 1/3 connect-src api.thinklet.io: FAIL", "color:red", e);
  }

  // Check 2 — SSE / streaming response body
  try {
    const r = await fetch("https://api.thinklet.io/ai/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "spike-test" }),
    });
    if (!r.body) {
      console.error("%c[spike] 2/3 SSE: FAIL (response.body is null — streaming blocked)", "color:red");
    } else {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let chunks = 0;
      let firstChunk = "";
      const startedAt = performance.now();
      while (chunks < 3) {
        const { done, value } = await reader.read();
        if (done) break;
        if (chunks === 0) firstChunk = dec.decode(value).slice(0, 80);
        chunks++;
        if (performance.now() - startedAt > 5000) break; // safety
      }
      reader.cancel().catch(() => {});
      console.log(
        `%c[spike] 2/3 SSE: PASS (status=${r.status}, chunks=${chunks}, first="${firstChunk}")`,
        "color:green",
      );
    }
  } catch (e) {
    console.error("%c[spike] 2/3 SSE: FAIL", "color:red", e);
  }

  // Check 3 — script-src dynamic import from esm.sh
  try {
    // @ts-expect-error dynamic URL import not in TS module graph
    const m: any = await import(/* @vite-ignore */ "https://esm.sh/marked@12");
    const ok = typeof m?.marked === "function" || typeof m?.default === "function";
    console.log(
      `%c[spike] 3/3 esm.sh dynamic import: ${ok ? "PASS" : "PARTIAL"} (keys=${Object.keys(m || {}).join(",")})`,
      `color:${ok ? "green" : "orange"}`,
    );
  } catch (e) {
    console.error("%c[spike] 3/3 esm.sh dynamic import: FAIL", "color:red", e);
  }

  console.log("%c[spike] === done — screenshot the three lines above ===", "font-weight:bold");
}

if (SPIKE_ENABLED) {
  runSpike().catch((e) => console.error("[spike] uncaught", e));
}

// Track app URL across render attempts so runtime failures can fall back cleanly.
let currentAppUrl: string | null = null;

function resetView() {
  loading.style.display = "none";
  rootEl.style.display = "none";
  errorEl.style.display = "none";
  errorEl.innerHTML = "";
}

function showError(msg: string) {
  resetView();
  errorEl.textContent = msg;
  errorEl.style.display = "flex";
}

function showEmbed(embedUrl: string, fallbackAppUrl?: string) {
  console.log("%c[viewer:embed] showEmbed() entered", "color:#0ea5e9", { embedUrl, fallbackAppUrl });
  resetView();

  const frame = document.createElement("iframe");
  frame.src = embedUrl;
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.minHeight = "480px";
  frame.style.border = "0";
  frame.allow = "clipboard-read; clipboard-write; fullscreen";
  frame.referrerPolicy = "no-referrer";

  let resolved = false;
  const onLoadFail = (reason: string) => {
    if (resolved) return;
    resolved = true;
    console.warn("%c[viewer:embed] load failed → fallback", "color:#ef4444", { reason });
    if (fallbackAppUrl) {
      showFallback(
        "Open in Thinklet",
        "Inline preview could not load. Open in Thinklet for the full experience.",
        fallbackAppUrl,
      );
    } else {
      showError("Embed failed to load.");
    }
  };

  frame.addEventListener("error", (e) => {
    console.error("[viewer:embed] iframe error event", e);
    onLoadFail("error-event");
  });
  const watchdog = window.setTimeout(() => onLoadFail("watchdog-8s"), 8000);
  frame.addEventListener("load", () => {
    if (resolved) return;
    resolved = true;
    console.log("%c[viewer:embed] iframe load fired", "color:#22c55e", {
      readyState: frame.contentDocument?.readyState ?? "(cross-origin)",
    });
    window.clearTimeout(watchdog);
  });

  loading.style.display = "none";
  rootEl.style.display = "block";
  rootEl.innerHTML = "";
  rootEl.appendChild(frame);
  console.log("%c[viewer:embed] iframe appended to #root", "color:#0ea5e9", {
    rootChildren: rootEl.childElementCount,
    rootDisplay: getComputedStyle(rootEl).display,
    rootRect: rootEl.getBoundingClientRect(),
    frameRect: frame.getBoundingClientRect(),
  });
  // Re-check 100ms later in case Claude's host swaps DOM after our render.
  window.setTimeout(() => {
    const stillThere = document.getElementById("root")?.querySelector("iframe");
    console.log("%c[viewer:embed] +100ms: iframe still in DOM?", "color:#0ea5e9", {
      stillThere: !!stillThere,
      iframeCount: document.querySelectorAll("iframe").length,
    });
  }, 100);
}

function showFallback(title: string, msg: string, appUrl?: string) {
  resetView();

  const card = document.createElement("div");
  card.style.maxWidth = "360px";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.alignItems = "center";
  card.style.gap = "12px";
  card.style.padding = "24px";
  card.style.border = "1px solid #e5e7eb";
  card.style.borderRadius = "16px";
  card.style.background = "#ffffff";
  card.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.06)";

  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "16px";
  heading.style.fontWeight = "600";
  heading.style.color = "#111827";

  const body = document.createElement("div");
  body.textContent = msg;
  body.style.fontSize = "13px";
  body.style.lineHeight = "1.5";
  body.style.color = "#4b5563";
  body.style.textAlign = "center";

  card.appendChild(heading);
  card.appendChild(body);

  if (appUrl) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open in Thinklet";
    button.style.border = "none";
    button.style.borderRadius = "9999px";
    button.style.padding = "10px 16px";
    button.style.background = "#111827";
    button.style.color = "#ffffff";
    button.style.fontSize = "13px";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.onclick = () => {
      // app.openLink() is the correct way to open URLs from a sandboxed MCP App
      // iframe — window.open() is blocked by the sandbox. openLink() sends a
      // message to Claude Desktop which opens the URL in the system browser.
      app.openLink({ url: appUrl }).catch(() => {
        // fallback: if openLink isn't available yet, try window.open anyway
        window.open(appUrl, "_blank", "noopener,noreferrer");
      });
    };
    card.appendChild(button);
  }

  errorEl.appendChild(card);
  errorEl.style.display = "flex";
}

function cleanImports(code: string): string {
  return code
    .replace(/^\s*import\s+type\s+.*?;?\s*$/gm, "")
    .replace(/^\s*import\s+['"].*?['"];?\s*$/gm, "")
    .replace(/^\s*import\s*{[\s\S]*?}\s*from\s*['"].*?['"];?\s*$/gm, "")
    .replace(/^\s*import\s+[\w*\s{},]*\s+from\s*['"].*?['"];?\s*$/gm, "")
    .replace(/export\s+default\s+/, "const Component = ");
}

// Detect if code uses platform-local services/imports that the inline viewer
// can't resolve yet. Those go to the app URL fallback instead of inline render.
function hasPlatformDependencies(code: string): boolean {
  return (
    /@\/services\//.test(code) ||
    /@\/hooks\//.test(code) ||
    /@\/components\//.test(code) ||
    /@\/lib\/tql/.test(code) ||
    /\baiApi\b/.test(code) ||
    /\bTQL\b/.test(code) ||
    /\buseAIStreaming\b/.test(code)
  );
}

// ─── CDN Module Registry ───────────────────────────────────────────────────
const CDN_MODULES: Record<string, { url: string; provides: string[] }> = {
  lucide: {
    url: "https://esm.sh/lucide-react?external=react,react-dom",
    provides: ["LucideIcon"],
  },
  framer: {
    url: "https://esm.sh/framer-motion?external=react,react-dom",
    provides: ["motion", "AnimatePresence", "useScroll", "useTransform", "useMotionValue", "useSpring", "useAnimation", "useInView"],
  },
  recharts: {
    url: "https://esm.sh/recharts?external=react,react-dom",
    provides: ["LineChart", "BarChart", "PieChart", "AreaChart", "RadarChart", "ScatterChart", "ComposedChart", "ResponsiveContainer", "XAxis", "YAxis", "CartesianGrid", "Tooltip", "Legend", "Line", "Bar", "Pie", "Area", "Radar", "Scatter", "Cell", "ReferenceLine", "ReferenceArea"],
  },
  zod: {
    url: "https://esm.sh/zod",
    provides: ["z"],
  },
  reactHookForm: {
    url: "https://esm.sh/react-hook-form?external=react,react-dom",
    provides: ["useForm", "useFieldArray", "useWatch", "Controller", "FormProvider"],
  },
  tanstack: {
    url: "https://esm.sh/@tanstack/react-query?external=react,react-dom",
    provides: ["useQuery", "useMutation", "useQueryClient", "QueryClient", "QueryClientProvider"],
  },
  lodash: {
    url: "https://esm.sh/lodash-es",
    provides: ["debounce", "throttle", "cloneDeep", "merge", "groupBy", "sortBy", "uniqBy"],
  },
};

function detectModules(code: string): string[] {
  const needed: string[] = [];

  if (/\b\w+Icon\b/.test(code) || /from ['"]lucide-react['"]/.test(code)) {
    needed.push("lucide");
  }
  if (CDN_MODULES.framer.provides.some((p) => new RegExp(`\\b${p}\\b`).test(code)) ||
    /from ['"]framer-motion['"]/.test(code)) {
    needed.push("framer");
  }
  if (CDN_MODULES.recharts.provides.some((p) => new RegExp(`\\b${p}\\b`).test(code)) ||
    /from ['"]recharts['"]/.test(code)) {
    needed.push("recharts");
  }
  if (/\bz\.(object|string|number|array|boolean|enum)\b/.test(code) ||
    /from ['"]zod['"]/.test(code)) {
    needed.push("zod");
  }
  if (CDN_MODULES.reactHookForm.provides.some((p) => new RegExp(`\\b${p}\\b`).test(code)) ||
    /from ['"]react-hook-form['"]/.test(code)) {
    needed.push("reactHookForm");
  }
  if (CDN_MODULES.tanstack.provides.some((p) => new RegExp(`\\b${p}\\b`).test(code)) ||
    /from ['"]@tanstack/.test(code)) {
    needed.push("tanstack");
  }
  if (CDN_MODULES.lodash.provides.some((p) => new RegExp(`\\b${p}\\b`).test(code)) ||
    /from ['"]lodash/.test(code)) {
    needed.push("lodash");
  }

  return [...new Set(needed)];
}

async function loadCDNModules(moduleKeys: string[]): Promise<Map<string, unknown>> {
  const loaded = new Map<string, unknown>();
  if (moduleKeys.length === 0) return loaded;

  await Promise.all(
    moduleKeys.map(async (key) => {
      const mod = CDN_MODULES[key];
      if (!mod) return;
      try {
        const m = await import(/* @vite-ignore */ mod.url);
        loaded.set(key, m);
      } catch (err) {
        console.warn(`[thinklet-viewer] CDN load failed for ${key}:`, err);
      }
    })
  );

  return loaded;
}

function buildResolverCode(moduleKeys: string[], code: string): string {
  const lines: string[] = [];

  if (moduleKeys.includes("lucide")) {
    const iconMatches = [...code.matchAll(/\b([A-Z][a-zA-Z]+Icon)\b/g)];
    const iconNames = [...new Set(iconMatches.map((m) => m[1]))];
    if (iconNames.length > 0) {
      lines.push(`const { ${iconNames.join(", ")} } = modules.get('lucide') || {};`);
    }
  }
  if (moduleKeys.includes("framer")) {
    lines.push(`const { ${CDN_MODULES.framer.provides.join(", ")} } = modules.get('framer') || {};`);
  }
  if (moduleKeys.includes("recharts")) {
    lines.push(`const { ${CDN_MODULES.recharts.provides.join(", ")} } = modules.get('recharts') || {};`);
  }
  if (moduleKeys.includes("zod")) {
    lines.push(`const { z } = modules.get('zod') || {};`);
  }
  if (moduleKeys.includes("reactHookForm")) {
    lines.push(`const { ${CDN_MODULES.reactHookForm.provides.join(", ")} } = modules.get('reactHookForm') || {};`);
  }
  if (moduleKeys.includes("tanstack")) {
    lines.push(`const { ${CDN_MODULES.tanstack.provides.join(", ")} } = modules.get('tanstack') || {};`);
  }
  if (moduleKeys.includes("lodash")) {
    lines.push(`const { ${CDN_MODULES.lodash.provides.join(", ")} } = modules.get('lodash') || {};`);
  }

  return lines.join("\n");
}

// ─── Renderer ─────────────────────────────────────────────────────────────

async function renderThinklet(code: string, fallbackAppUrl?: string) {
  // Track fallback so runtime errors can trigger the app URL fallback.
  currentAppUrl = fallbackAppUrl ?? null;

  try {
    const moduleKeys = detectModules(code);
    const loadedModules = await loadCDNModules(moduleKeys);
    const cleaned = cleanImports(code);
    const resolverCode = buildResolverCode(moduleKeys, code);

    const wrapped = `
      (function createComponent(React, modules, __showError) {
        'use strict';
        const {
          useState, useEffect, useRef, useMemo, useCallback,
          useContext, useReducer, useLayoutEffect, useImperativeHandle,
          useDebugValue, createContext, createRef, forwardRef,
          memo, Fragment, Children, cloneElement, isValidElement, createElement
        } = React;
        ${resolverCode}
        ${cleaned}
        return typeof Component !== 'undefined' ? Component : null;
      })
    `;

    const transformed = transform(wrapped, {
      transforms: ["jsx"],
      production: true,
    }).code;

    const factory = (0, eval)(transformed);
    const ComponentType = factory(React, loadedModules, showError);

    if (!ComponentType) {
      if (fallbackAppUrl) {
        showFallback(
          "Open in Thinklet",
          "This thinklet is available in the full Thinklet app.",
          fallbackAppUrl,
        );
        return;
      }
      showError("No Component found in thinklet code.");
      return;
    }

    loading.style.display = "none";
    rootEl.style.display = "block";
    const reactRoot = createRoot(rootEl);

    // Runtime errors fall back to the full Thinklet app if available.
    window.onerror = (msg) => {
      if (currentAppUrl) {
        showFallback(
          "Open in Thinklet",
          "Inline preview hit a runtime error. Open it in Thinklet for the full experience.",
          currentAppUrl,
        );
        currentAppUrl = null; // prevent loop
        return true;
      }
      showError(`Runtime: ${msg}`);
      return true;
    };

    // Unhandled promise rejections → same fallback
    window.onunhandledrejection = (event) => {
      if (currentAppUrl) {
        showFallback(
          "Open in Thinklet",
          "Inline preview hit a runtime error. Open it in Thinklet for the full experience.",
          currentAppUrl,
        );
        currentAppUrl = null;
        event.preventDefault();
        return;
      }
      showError(`Runtime: ${event.reason?.message || event.reason}`);
    };

    // Wrap in QueryClientProvider if tanstack loaded (thinklets using useMutation need it)
    const tanstackMod = loadedModules.get("tanstack") as any;
    const defaultProps = { content: {}, updateContent: () => {} };

    if (tanstackMod?.QueryClient && tanstackMod?.QueryClientProvider) {
      const queryClient = new tanstackMod.QueryClient();
      reactRoot.render(
        React.createElement(tanstackMod.QueryClientProvider, { client: queryClient },
          React.createElement(ComponentType, defaultProps)
        )
      );
    } else {
      reactRoot.render(React.createElement(ComponentType, defaultProps));
    }
  } catch (err) {
    if (fallbackAppUrl) {
      showFallback(
        "Open in Thinklet",
        "Inline preview is not available for this thinklet yet.",
        fallbackAppUrl,
      );
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    showError(`Render failed: ${msg}`);
  }
}

// ─── MCP App ───────────────────────────────────────────────────────────────

function extractAppUrl(result: Record<string, unknown>): string | null {
  const sc = result.structuredContent as { appUrl?: string } | undefined;
  if (sc?.appUrl) return sc.appUrl;
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  for (const block of content ?? []) {
    if (block.type === "text" && block.text) {
      const directMatch = block.text.match(/🔗\s*(https?:\/\/\S+)/);
      if (directMatch) return directMatch[1].trim();
      const markdownMatch = block.text.match(/\[Open in Thinklet\]\((https?:\/\/[^)]+)\)/);
      if (markdownMatch) return markdownMatch[1].trim();
    }
  }
  return null;
}

const app = new App({ name: "Thinklet Viewer", version: "0.5.0" });

app.ontoolresult = (result) => {
  const data = result as Record<string, unknown>;
  const sc = data.structuredContent as
    | { code?: string; appUrl?: string; embedUrl?: string }
    | undefined;
  const appUrl = extractAppUrl(data) ?? sc?.appUrl ?? undefined;
  const embedUrl = sc?.embedUrl ?? undefined;
  const platformDeps = sc?.code ? hasPlatformDependencies(sc.code) : false;

  console.log("[viewer] has code:", !!sc?.code);
  console.log("[viewer] has appUrl:", !!appUrl);
  console.log("[viewer] has embedUrl:", !!embedUrl);
  console.log("[viewer] platform deps:", sc?.code ? platformDeps : "n/a");

  // ─── Path selection ────────────────────────────────────────────────────
  // The iframe-embed path (loading content.thinklet.io inside Claude's
  // webview) is currently disabled because Claude Desktop's host CSP does
  // not honor `_meta.ui.csp.frameDomains` — `frame-src` stays at
  // `'self' blob: data:` regardless of what we declare. Confirmed
  // 2026-05-06 with both config-level and content-item-level placements.
  // The `showEmbed` helper and embedUrl plumbing are kept intact so we can
  // flip back on quickly when Anthropic fixes frameDomains.
  const path =
    sc?.code && !platformDeps ? "flat" :
    platformDeps ? "fallback-app-url" :
    appUrl ? "fallback-app-url" :
    sc?.code ? "flat-last-resort" :
    "no-preview";
  console.log("[viewer] path taken:", path);

  // 1. Simple thinklets (no platform deps) → flat inline render.
  if (sc?.code && !platformDeps) {
    renderThinklet(sc.code, appUrl);
    return;
  }

  // 2. Complex thinklets (platform deps) → CTA banner. We deliberately do
  //    NOT try the iframe path: the host CSP blocks it, the iframe loads
  //    `about:blank`, and `load` fires anyway, leaving a white screen.
  if (platformDeps) {
    showFallback(
      "Open in Thinklet",
      "This thinklet uses platform services. Open in Thinklet to use it.",
      appUrl,
    );
    return;
  }

  // 3. No code but an app URL → CTA.
  if (appUrl) {
    showFallback(
      "Open in Thinklet",
      "Inline preview is not available for this thinklet yet.",
      appUrl,
    );
    return;
  }

  // 4. Code present but earlier branches didn't catch it → last-resort flat.
  if (sc?.code) {
    renderThinklet(sc.code, appUrl);
    return;
  }

  showError("Could not load thinklet preview or fallback link.");
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};

app.connect();
