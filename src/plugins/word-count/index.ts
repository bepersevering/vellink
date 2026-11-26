/** 示例插件：M3 验收锚点——20 行级实现，命令可读文档、写私有存储、订阅事件。 */
import type { PluginContext, PluginModule } from "../../core/plugin/runtime";

function report(ctx: PluginContext): boolean {
  const doc = ctx.documents.getDocument();
  const chars = doc.source.replace(/\s/g, "").length;
  const times = Number(ctx.storage.get<number>("reports") ?? 0) + 1;
  ctx.storage.set("reports", times);
  ctx.notify(`当前文档 ${chars} 字 · 第 ${times} 次统计`);
  return true;
}

const plugin: PluginModule = {
  activate(ctx) {
    ctx.log("已激活");
    ctx.events.on("document:changed", (event) => ctx.log(`文档更新至 v${event.version}`));
  },
  deactivate() {
    console.info("[plugin:word-count] 已停用");
  },
  commands: { report },
};

export default plugin;
