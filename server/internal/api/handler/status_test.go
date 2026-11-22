package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestStatusReportsDataDisk(t *testing.T) {
	old := DataDir
	DataDir = t.TempDir()
	defer func() { DataDir = old }()

	app := fiber.New()
	app.Get("/api/status", Status)

	resp, err := app.Test(httptest.NewRequest("GET", "/api/status", nil))
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Disk *diskInfo `json:"disk"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	d := body.Disk
	if d == nil {
		t.Fatal("disk is null for an existing directory")
	}
	if d.TotalBytes == 0 || d.UsedBytes > d.TotalBytes || d.FreeBytes > d.TotalBytes {
		t.Fatalf("implausible disk numbers: %+v", d)
	}
	if d.UsedPercent < 0 || d.UsedPercent > 100 {
		t.Fatalf("used_percent out of range: %v", d.UsedPercent)
	}
}

func TestStatusDiskNullWhenDirMissing(t *testing.T) {
	old := DataDir
	DataDir = "/nonexistent/kast-data-dir"
	defer func() { DataDir = old }()

	if d := dataDiskUsage(); d != nil {
		t.Fatalf("expected nil for missing dir, got %+v", d)
	}
}
