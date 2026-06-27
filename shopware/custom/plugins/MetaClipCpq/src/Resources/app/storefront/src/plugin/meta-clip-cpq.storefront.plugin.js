import Plugin from "src/plugin-system/plugin.class";
import { mountCpqPdpIsland } from "../vue/cpq-pdp-island";

export default class MetaClipCpqStorefrontPlugin extends Plugin {
  init() {
    this.cleanup = mountCpqPdpIsland(this.el);
  }

  destroy() {
    if (typeof this.cleanup === "function") {
      this.cleanup();
      this.cleanup = null;
    }

    super.destroy();
  }
}
