import type { WidgetDefinition } from "@opsdash/plugin-sdk/client";
import { signal } from "@preact/signals";

const modules = new Map<string, Promise<WidgetDefinition>>();
const styles = new Map<string, HTMLLinkElement>();

/** Bumped when a plugin is hot-reloaded so its widgets re-mount (dev). */
export const pluginRevisions = signal<Record<string, string>>({});

/** Loads a plugin's widget module once per URL (the URL carries the plugin revision). */
export function loadWidget(pluginId: string, clientUrl: string, styleUrl?: string): Promise<WidgetDefinition> {
  if (styleUrl && styles.get(pluginId)?.getAttribute("href") !== styleUrl) {
    styles.get(pluginId)?.remove();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = styleUrl;
    document.head.appendChild(link);
    styles.set(pluginId, link);
  }
  let mod = modules.get(clientUrl);
  if (!mod) {
    mod = import(/* @vite-ignore */ clientUrl).then((m: { default: WidgetDefinition }) => m.default);
    modules.set(clientUrl, mod);
  }
  return mod;
}

export function pluginReloaded(id: string, clientUrl?: string): void {
  pluginRevisions.value = { ...pluginRevisions.value, [id]: clientUrl ?? String(Date.now()) };
}
