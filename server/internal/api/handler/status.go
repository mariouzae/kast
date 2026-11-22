package handler

import (
	"math"
	"os"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/riza/kast/internal/api/respond"
	"github.com/riza/kast/internal/version"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/process"
)

var startTime = time.Now()

// DataDir is the directory whose filesystem is reported under "disk" in
// GET /api/status. It matches the data dir used in cmd/kast/main.go (kast.db,
// HLS segments, music); in Docker that is the kast_data volume.
var DataDir = "./data"

// diskInfo is the usage of the filesystem holding DataDir.
type diskInfo struct {
	Path        string  `json:"path"`
	TotalBytes  uint64  `json:"total_bytes"`
	UsedBytes   uint64  `json:"used_bytes"`
	FreeBytes   uint64  `json:"free_bytes"` // available to unprivileged users
	UsedPercent float64 `json:"used_percent"`
}

func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

func dataDiskUsage() *diskInfo {
	u, err := disk.Usage(DataDir)
	if err != nil || !finite(u.UsedPercent) {
		return nil
	}
	return &diskInfo{
		Path:        u.Path,
		TotalBytes:  u.Total,
		UsedBytes:   u.Used,
		FreeBytes:   u.Free,
		UsedPercent: u.UsedPercent,
	}
}

// Status godoc: GET /api/status
func Status(c *fiber.Ctx) error {
	cpuPercent := -1.0
	memRSSMB := -1

	proc, err := process.NewProcess(int32(os.Getpid()))
	if err == nil {
		// CPUPercent divides by elapsed time and can yield NaN/Inf when that
		// rounds to zero; JSON can't encode those, which turned into a 500.
		if cpu, err := proc.CPUPercent(); err == nil && finite(cpu) {
			cpuPercent = cpu
		}
		if mem, err := proc.MemoryInfo(); err == nil {
			memRSSMB = int(mem.RSS / 1024 / 1024)
		}
	}

	return respond.OK(c, fiber.Map{
		"version":     version.Version,
		"git_commit":  version.GitCommit,
		"build_time":  version.BuildTime,
		"uptime_sec":  int(time.Since(startTime).Seconds()),
		"go_version":  runtime.Version(),
		"os_arch":     runtime.GOOS + "/" + runtime.GOARCH,
		"cpu_percent": cpuPercent,
		"mem_rss_mb":  memRSSMB,
		"disk":        dataDiskUsage(), // null when unavailable
	})
}
