package webserver

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
)

// ServerStatusResponse represents the status of a single server
type ServerStatusResponse struct {
	ConnectionID     string  `json:"connectionId"`
	ConnectionName   string  `json:"connectionName"`
	URL              string  `json:"url"`
	Online           bool    `json:"online"`
	ResponseTimeMs   int64   `json:"responseTimeMs"`
	MemoryUsed       int64   `json:"memoryUsed"`
	MemoryFree       int64   `json:"memoryFree"`
	MemoryTotal      int64   `json:"memoryTotal"`
	MemoryUsedPct    float64 `json:"memoryUsedPct"`
	CPULoad          float64 `json:"cpuLoad"`
	WorkspaceCount   int     `json:"workspaceCount"`
	LayerCount       int     `json:"layerCount"`
	DataStoreCount   int     `json:"dataStoreCount"`
	CoverageCount    int     `json:"coverageCount"`
	StyleCount       int     `json:"styleCount"`
	Error            string  `json:"error,omitempty"`
	GeoServerVersion string  `json:"geoserverVersion,omitempty"`
}

// DashboardResponse contains status for all servers
type DashboardResponse struct {
	Servers          []ServerStatusResponse `json:"servers"`
	OnlineCount      int                    `json:"onlineCount"`
	OfflineCount     int                    `json:"offlineCount"`
	TotalLayers      int                    `json:"totalLayers"`
	TotalStores      int                    `json:"totalStores"`
	AlertServers     []ServerStatusResponse `json:"alertServers"`     // Servers with errors
	PingIntervalSecs int                    `json:"pingIntervalSecs"` // Dashboard refresh interval
}

// handleDashboard returns status for all configured servers
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := DashboardResponse{
		Servers:          make([]ServerStatusResponse, 0),
		AlertServers:     make([]ServerStatusResponse, 0),
		PingIntervalSecs: cfg.GetPingInterval(),
	}

	// Fetch status for all servers concurrently
	var wg sync.WaitGroup
	statusChan := make(chan ServerStatusResponse, len(cfg.Connections))

	for _, conn := range cfg.Connections {
		wg.Add(1)
		go func(conn config.Connection) {
			defer wg.Done()
			status := fetchServerStatus(&conn)
			statusChan <- status
		}(conn)
	}

	// Wait for all goroutines to complete
	go func() {
		wg.Wait()
		close(statusChan)
	}()

	// Collect results
	for status := range statusChan {
		response.Servers = append(response.Servers, status)
		if status.Online {
			response.OnlineCount++
			response.TotalLayers += status.LayerCount
			response.TotalStores += status.DataStoreCount + status.CoverageCount
		} else {
			response.OfflineCount++
			response.AlertServers = append(response.AlertServers, status)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleServerStatus returns status for a single server
func (s *Server) handleServerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get connection ID from path
	connID := r.URL.Query().Get("id")
	if connID == "" {
		http.Error(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	conn := cfg.GetConnection(connID)
	if conn == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	status := fetchServerStatus(conn)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// fetchServerStatus fetches the status for a single connection
func fetchServerStatus(conn *config.Connection) ServerStatusResponse {
	client := api.NewClient(conn)

	status := ServerStatusResponse{
		ConnectionID:   conn.ID,
		ConnectionName: conn.Name,
		URL:            conn.URL,
		Online:         false,
	}

	// Get server status (quick check)
	serverStatus, err := client.GetServerStatus()
	if err != nil {
		status.Error = err.Error()
		return status
	}

	status.Online = serverStatus.Online
	status.ResponseTimeMs = serverStatus.ResponseTimeMs
	status.MemoryUsed = serverStatus.MemoryUsed
	status.MemoryFree = serverStatus.MemoryFree
	status.MemoryTotal = serverStatus.MemoryTotal
	status.MemoryUsedPct = serverStatus.MemoryUsedPct
	status.CPULoad = serverStatus.CPULoad
	status.Error = serverStatus.Error
	status.GeoServerVersion = serverStatus.GeoServerVersion

	if !status.Online {
		return status
	}

	// Get resource counts (slower, may timeout on large servers)
	counts, _ := client.GetServerCounts()
	if counts != nil {
		status.WorkspaceCount = counts.WorkspaceCount
		status.LayerCount = counts.LayerCount
		status.DataStoreCount = counts.DataStoreCount
		status.CoverageCount = counts.CoverageCount
		status.StyleCount = counts.StyleCount
	}

	return status
}
