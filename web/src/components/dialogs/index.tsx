import ConnectionDialog from './ConnectionDialog'
import WorkspaceDialog from './WorkspaceDialog'
import ConfirmDialog from './ConfirmDialog'
import UploadDialog from './UploadDialog'
import LayerGroupDialog from './LayerGroupDialog'
import CacheDialog from './CacheDialog'
import LayerDialog from './LayerDialog'
import StoreDialog from './StoreDialog'
import AppSettingsDialog from './AppSettingsDialog'
import QueryDialog from './QueryDialog'
import DataViewerDialog from './DataViewerDialog'
import PGServiceDashboardDialog from './PGServiceDashboardDialog'
import PGUploadDialog from './PGUploadDialog'
import S3ConnectionDialog from './S3ConnectionDialog'
import S3UploadDialog from './S3UploadDialog'
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
      <AppSettingsDialog />
      <QueryDialog />
      <DataViewerDialog />
      <PGServiceDashboardDialog />
      <PGUploadDialog />
      <S3ConnectionDialog />
      <S3UploadDialog />
    </>
  )
}

export { SettingsDialog, SyncDialog, StyleDialog, Globe3DDialog, QueryDialog }
