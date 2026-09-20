import {createContext} from 'react';

export type DraftSaver = () => Promise<void>;
export type RegisterDraftSaver = (save: DraftSaver) => () => void;

// The root owns mode transitions; the active editor owns its drafts. Keeping
// their contract here avoids coupling the root to the editor's state shape.
export const DraftSaveContext = createContext<RegisterDraftSaver>(() => () => undefined);
