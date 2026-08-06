import { FiDatabase, FiImage } from 'react-icons/fi'

export const PGStore = {
  DATASTORE: 'datastore',
  COVERAGE_STORE: 'coveragestore',
} as const;

export const PGStoreIcon = {
  [PGStore.DATASTORE]: FiDatabase,
  [PGStore.COVERAGE_STORE]: FiImage
};

export const PGStoreText = {
  [PGStore.DATASTORE]: 'Data Store',
  [PGStore.COVERAGE_STORE]: 'Coverage Store'
};

export const PGEditorMode = {
  CREATE: 'create',
  EDIT: 'edit',
} as const;

export type PGEditorModeType = typeof PGEditorMode[keyof typeof PGEditorMode];

export interface PGStoreProps {
  connectionId: string;
  workspace: boolean;
  storeName?: boolean;
  mode: PGEditorModeType;
}
