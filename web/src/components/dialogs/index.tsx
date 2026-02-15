import ConnectionDialog from './ConnectionDialog'
import WorkspaceDialog from './WorkspaceDialog'
import ConfirmDialog from './ConfirmDialog'
import UploadDialog from './UploadDialog'
import LayerGroupDialog from './LayerGroupDialog'
import CacheDialog from './CacheDialog'
import LayerDialog from './LayerDialog'
import StoreDialog from './StoreDialog'
import { SettingsDialog } from './SettingsDialog'
import { SyncDialog } from './SyncDialog'
import { StyleDialog } from './StyleDialog'
import { Globe3DDialog } from './Globe3DDialog'

export default function Dialogs() {
  return (
    <>
      <ConnectionDialog />
      <WorkspaceDialog />
      <ConfirmDialog />
      <UploadDialog />
      <LayerGroupDialog />
      <CacheDialog />
      <LayerDialog />
      <StoreDialog />
      <SyncDialog />
      <StyleDialog />
      <Globe3DDialog />
    </>
  )
}

export { SettingsDialog, SyncDialog, StyleDialog, Globe3DDialog }
