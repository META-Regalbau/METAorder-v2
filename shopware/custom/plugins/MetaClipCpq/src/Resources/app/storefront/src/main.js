import "./scss/meta-clip-cpq.scss";
import MetaClipCpqStorefrontPlugin from "./plugin/meta-clip-cpq.storefront.plugin";

const pluginManager = window.PluginManager;

if (!pluginManager) {
  // TODO verify: In manchen Shopware-Build-Modi ist der PluginManager verzögert verfügbar.
  // Dieser Fallback verhindert einen Hard-Crash auf der PDP.
  // eslint-disable-next-line no-console
  console.warn("[MetaClipCpq] PluginManager not available during storefront bootstrap");
} else {
  pluginManager.register(
    "MetaClipCpqStorefrontPlugin",
    MetaClipCpqStorefrontPlugin,
    "[data-meta-clip-cpq]"
  );
}
