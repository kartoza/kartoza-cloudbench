import ConnectionDialog from './ConnectionDialog'
import WorkspaceDialog from './WorkspaceDialog'
import ConfirmDialog from './ConfirmDialog'
import UploadDialog from './UploadDialog'
import LayerGroupDialog from './LayerGroupDialog'
import CacheDialog from './CacheDialog'
import LayerDialog from './LayerDialog'
import GeoServerDataStoreEditorDialog from './GeoServerDataStoreEditorDialog'
import AppSettingsDialog from './AppSettingsDialog'
import DataViewerDialog from './DataViewerDialog'
import PGServiceDashboardDialog from './PGServiceDashboardDialog'
import PGUploadDialog from './PGUploadDialog'
import S3ConnectionDialog from './S3ConnectionDialog'
import S3UploadDialog from './S3UploadDialog'
import QGISProjectDialog from './QGISProjectDialog'
import QGISPreviewDialog from './QGISPreviewDialog'
import GeoNodeConnectionDialog from './GeoNodeConnectionDialog'
import GeoNodeUploadDialog from './GeoNodeUploadDialog'
import GeoNodeAddRemoteServiceDialog from './GeoNodeAddRemoteServiceDialog'
import IcebergConnectionDialog from './IcebergConnectionDialog'
import IcebergNamespaceDialog from './IcebergNamespaceDialog'
import IcebergTableDialog from './IcebergTableDialog'
import IcebergTableSchemaDialog from './IcebergTableSchemaDialog'
import IcebergTableDataDialog from './IcebergTableDataDialog'
import IcebergQueryDialog from './IcebergQueryDialog'
import QFieldCloudConnectionDialog from './QFieldCloudConnectionDialog'
import MerginMapsConnectionDialog from './MerginMapsConnectionDialog'
import GeoServerDataStorePGConnectDialog from './GeoServerDataStorePGConnectDialog'
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
      <GeoServerDataStoreEditorDialog />
      <SyncDialog />
      <StyleDialog />
      <Globe3DDialog />
      <AppSettingsDialog />
      <DataViewerDialog />
      <PGServiceDashboardDialog />
      <PGUploadDialog />
      <S3ConnectionDialog />
      <S3UploadDialog />
      <QGISProjectDialog />
      <QGISPreviewDialog />
      <GeoNodeConnectionDialog />
      <GeoNodeUploadDialog />
      <GeoNodeAddRemoteServiceDialog />
      <IcebergConnectionDialog />
      <IcebergNamespaceDialog />
      <IcebergTableDialog />
      <IcebergTableSchemaDialog />
      <IcebergTableDataDialog />
      <IcebergQueryDialog />
      <QFieldCloudConnectionDialog />
      <MerginMapsConnectionDialog />
      <GeoServerDataStorePGConnectDialog />
    </>
  )
}

export { SettingsDialog, SyncDialog, StyleDialog, Globe3DDialog }
