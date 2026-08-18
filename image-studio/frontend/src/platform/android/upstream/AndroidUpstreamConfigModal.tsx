import { Modal } from "../../../components/common/Modal";
import { AndroidUpstreamEmptyState } from "./AndroidUpstreamEmptyState";
import { AndroidUpstreamHeader } from "./AndroidUpstreamHeader";
import { AndroidUpstreamProfileForm } from "./AndroidUpstreamProfileForm";
import { AndroidUpstreamProfileRail } from "./AndroidUpstreamProfileRail";
import { useAndroidUpstreamConfig } from "./useAndroidUpstreamConfig";
import { Info } from "lucide-react";

export function AndroidUpstreamConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const upstream = useAndroidUpstreamConfig(open);

  return (
    <Modal open={open} onClose={onClose} title="上游配置" width={880}>
      <div className="android-upstream-panel">
        <AndroidUpstreamHeader
          activeProfile={upstream.activeProfile}
          profileCount={upstream.profiles.length}
          onQuickImport={() => upstream.setQuickImportOpen(true)}
        />

        {upstream.profiles.length === 0 ? (
          <AndroidUpstreamEmptyState
            onCreate={upstream.handleNew}
            onQuickImport={() => upstream.setQuickImportOpen(true)}
          />
        ) : (
          <div className="android-upstream-workspace">
            <AndroidUpstreamProfileRail
              profiles={upstream.profiles}
              selectedId={upstream.selectedId}
              activeProfileId={upstream.activeProfileId}
              onCreate={() => upstream.handleNew()}
              onDuplicate={upstream.handleDuplicate}
              onDelete={upstream.handleDelete}
              onSelect={upstream.setSelectedId}
            />

            {upstream.draft ? (
              <AndroidUpstreamProfileForm
                activeProfileId={upstream.activeProfileId}
                baseURLError={upstream.baseURLError}
                canSave={upstream.canSave}
                draft={upstream.draft}
                draftKey={upstream.draftKey}
                isTestingKey={upstream.isTestingKey}
                loadingModels={upstream.loadingModels}
                modelCatalog={upstream.modelCatalog}
                modelCatalogError={upstream.modelCatalogError}
                onChangeDraftKey={upstream.setDraftKey}
                onLoadModels={upstream.handleLoadModels}
                onPatchDraft={upstream.patchDraft}
                onSave={async () => {
                  const saved = await upstream.handleSave();
                  if (saved) onClose();
                }}
                onSaveAndSetActive={() => upstream.handleSaveAndSetActive(onClose)}
                onSaveAndTest={() => upstream.handleSaveAndTest(onClose)}
                onSetActive={upstream.handleSetActive}
                savedKeyLoaded={upstream.savedKeyLoaded}
                saving={upstream.saving}
                showKey={upstream.showKey}
                onToggleShowKey={() => upstream.setShowKey((value) => !value)}
              />
            ) : null}
          </div>
        )}
      </div>
      <Modal
        open={upstream.quickImportOpen}
        onClose={() => upstream.setQuickImportOpen(false)}
        title="快捷导入"
        width={520}
      >
        <section className="android-upstream-quick-import-sheet">
          <p>
            粘贴对方提供的 JSON 模板。当前支持本应用导出文件、<code className="font-mono-token">newapi_channel_conn</code>、OpenCode <code className="font-mono-token">provider</code> 配置。
          </p>
          <textarea
            value={upstream.quickImportText}
            onChange={(event) => upstream.setQuickImportText(event.target.value)}
            placeholder={"在这里粘贴 JSON...\n例如 {\"_type\":\"newapi_channel_conn\",...}"}
            className="focus-ring android-upstream-quick-import-textarea font-mono-token"
            spellCheck={false}
          />
          <div className="android-upstream-quick-import-hint">
            <Info className="h-4 w-4" />
            <span>导入后会自动适配站点根地址并写入系统凭据存储。</span>
          </div>
          <div className="android-upstream-actions">
            <button type="button" onClick={() => upstream.setQuickImportOpen(false)}>
              取消
            </button>
            <button type="button" className="primary" onClick={() => void upstream.handleQuickImport()}>
              立即导入
            </button>
          </div>
        </section>
      </Modal>
    </Modal>
  );
}
