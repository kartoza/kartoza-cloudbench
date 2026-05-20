"""GeoServer views package.

Imports all view classes for URL routing.
"""

from .coverages import CoverageDetailView, CoverageListView
from .coveragestores import CoverageStoreDetailView, CoverageStoreListView
from .datastores import (
    DataStoreAvailableView,
    DataStoreConnectPGView,
    DataStoreDetailView,
    DataStoreListView,
    DataStorePublishView,
)
from .featuretypes import FeatureTypeDetailView, FeatureTypeListView
from .layergroups import LayerGroupDetailView, LayerGroupListView
from .layers import (
    LayerCountView,
    LayerDetailView,
    LayerListView,
    LayerMetadataView,
    LayerStylesView,
)
from .styles import StyleDetailView, StyleListView
from .uploads import GeoServerUploadCompleteView, GeoServerUploadStartView, GeoServerUploadStatusView
from .workspaces import WorkspaceDetailView, WorkspaceListView

__all__ = [
    # Workspaces
    "WorkspaceListView",
    "WorkspaceDetailView",
    # Data Stores
    "DataStoreListView",
    "DataStoreDetailView",
    "DataStoreAvailableView",
    "DataStorePublishView",
    "DataStoreConnectPGView",
    # Coverage Stores
    "CoverageStoreListView",
    "CoverageStoreDetailView",
    # Feature Types
    "FeatureTypeListView",
    "FeatureTypeDetailView",
    # Coverages
    "CoverageListView",
    "CoverageDetailView",
    # Layers
    "LayerListView",
    "LayerDetailView",
    "LayerCountView",
    "LayerMetadataView",
    "LayerStylesView",
    # Styles
    "StyleListView",
    "StyleDetailView",
    # Layer Groups
    "LayerGroupListView",
    "LayerGroupDetailView",
    # Uploads
    "GeoServerUploadCompleteView",
    "GeoServerUploadStartView",
    "GeoServerUploadStatusView",
]
