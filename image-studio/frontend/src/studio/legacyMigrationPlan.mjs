/** Start legacy migration once per window; never delete old records on failure. */
export function createLegacyMigration(dependencies) {
  let preparation;
  const warnings = [];
  return {
    prepare() {
      preparation ??= (async () => {
        try {
          await dependencies.restoreCompatibility();
        } catch {
          warnings.push("旧版备份暂未恢复；原数据已保留，下次启动会重试。");
        }
        try {
          await dependencies.prepareUpstreams();
        } catch {
          warnings.push("旧版上游暂未完成导入；请检查设置，原配置已保留。");
        }
        try {
          await dependencies.withHistoryLock(async () => {
            const local = await dependencies.loadHistory();
            const noFile = local.filter((item) => !item.sharedJobId && !item.savedPath).length;
            if (noFile) warnings.push(`${noFile} 条旧历史没有可定位的原文件，暂未加入工作室；本地记录及图片缓存已保留。`);
            const imported = await dependencies.importHistory(local, (message) => warnings.push(message));
            const changed = imported.filter((item, index) => item !== local[index]);
            if (changed.length) await dependencies.persistHistory(changed);
          });
        } catch {
          warnings.push("部分旧历史暂未迁移；原文件和本地记录已保留，下次启动会重试。");
        }
      })();
      return preparation;
    },
    takeWarning() {
      return warnings.splice(0).join("\n");
    },
  };
}
