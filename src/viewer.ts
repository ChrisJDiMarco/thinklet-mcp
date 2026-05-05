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
      window.open(appUrl, "_blank", "noopener,noreferrer");
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
  const sc = data.structuredContent as { code?: string; appUrl?: string } | undefined;
  const appUrl = extractAppUrl(data) ?? sc?.appUrl ?? undefined;

  console.log("[viewer] has code:", !!sc?.code);
  console.log("[viewer] has appUrl:", !!appUrl);
  console.log("[viewer] platform deps:", sc?.code ? hasPlatformDependencies(sc.code) : "n/a");

  console.log("[viewer] path taken:", 
    sc?.code && !hasPlatformDependencies(sc.code) ? "flat" :
    sc?.code && hasPlatformDependencies(sc.code) ? "fallback-app-url" :
    appUrl ? "fallback-app-url" :
    sc?.code ? "flat-last-resort" : "no-preview"
  );

  if (sc?.code && !hasPlatformDependencies(sc.code)) {
    renderThinklet(sc.code, appUrl);
    return;
  }

  if (sc?.code && hasPlatformDependencies(sc.code)) {
    showFallback(
      "Open in Thinklet",
      "This thinklet uses platform services that are not available inline yet.",
      appUrl,
    );
    return;
  }

  if (appUrl) {
    showFallback(
      "Open in Thinklet",
      "Inline preview is not available for this thinklet yet.",
      appUrl,
    );
    return;
  }

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
