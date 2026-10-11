import {lazy, Suspense, useCallback, useRef, useState} from 'react';
import {usePlatform} from '../platform/context';
import {StudioApp} from './StudioApp';
import {DraftSaveContext, type DraftSaver} from './DraftSaveContext';
import './studio.css';
import './polish.css';

const ClassicApp = lazy(() => import('../app/App'));

export default function StudioRoot() {
  const {isAndroid, isMac} = usePlatform();
  const [classic, setClassic] = useState(false);
  const saver = useRef<DraftSaver>();
  const switching = useRef(false);
  const registerSaver = useCallback((save: DraftSaver) => {
    saver.current = save;
    return () => {if (saver.current === save) saver.current = undefined;};
  }, []);
  const enterClassic = async () => {
    if (switching.current) return;
    switching.current = true;
    try {
      // Guard every entry point, including the settings shortcut. A stale
      // snapshot cannot omit drafts that the active editor has just created.
      await saver.current?.();
      setClassic(true);
    } catch {
      // useStudio reports the save error and retains the editable draft.
      // Do not unmount it or silently navigate after a persistence failure.
    } finally {
      switching.current = false;
    }
  };
  if (isAndroid || classic) {
    return <>
      <Suspense fallback={<div className="studio-loading">正在打开经典编辑器…</div>}>
        <ClassicApp/>
      </Suspense>
      {!isAndroid && <button className="studio-return" onClick={() => setClassic(false)}>返回新版工作室</button>}
    </>;
  }
  return <DraftSaveContext.Provider value={registerSaver}>
    <StudioApp isMac={isMac} onClassic={enterClassic}/>
  </DraftSaveContext.Provider>;
}
