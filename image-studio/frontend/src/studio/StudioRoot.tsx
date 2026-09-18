import {lazy, Suspense, useState} from 'react';
import {usePlatform} from '../platform/context';
import {StudioApp} from './StudioApp';
import './studio.css';
import './polish.css';

const ClassicApp = lazy(() => import('../app/App'));

export default function StudioRoot() {
  const {isAndroid, isMac} = usePlatform();
  const [classic, setClassic] = useState(false);
  if (isAndroid || classic) {
    return <>
      <Suspense fallback={<div className="studio-loading">正在打开经典编辑器…</div>}>
        <ClassicApp/>
      </Suspense>
      {!isAndroid && <button className="studio-return" onClick={() => setClassic(false)}>返回新版工作室</button>}
    </>;
  }
  return <StudioApp isMac={isMac} onClassic={() => setClassic(true)}/>;
}
