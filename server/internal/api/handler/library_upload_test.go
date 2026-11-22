package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"github.com/riza/kast/internal/db"
	"github.com/riza/kast/internal/library"
	"github.com/riza/kast/internal/playlist"
)

func TestCleanUploadPath(t *testing.T) {
	ok := map[string][2]string{
		"song.mp3":                {"", "song.mp3"},
		"Album/01 Intro.mp3":      {"Album", "01 Intro.mp3"},
		"Artist/Album/CD1/a.flac": {filepath.Join("Artist", "Album", "CD1"), "a.flac"},
		`Win\Folder\b.mp3`:        {"Win" + string(filepath.Separator) + "Folder", "b.mp3"},
	}
	for in, want := range ok {
		dir, name, err := cleanUploadPath(in)
		require.NoError(t, err, in)
		require.Equal(t, want[0], dir, in)
		require.Equal(t, want[1], name, in)
	}

	for _, bad := range []string{
		"", "/etc/passwd.mp3", "../escape.mp3", "Album/../../escape.mp3",
		"Album//a.mp3", "./a.mp3", ".hidden/a.mp3", "Album/.a.mp3",
	} {
		_, _, err := cleanUploadPath(bad)
		require.Error(t, err, "expected %q to be rejected", bad)
	}
}

// upload posts files with optional relative paths and returns the result list.
func upload(t *testing.T, h *Library, files map[string]string) []map[string]string {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for path, content := range files {
		fw, err := w.CreateFormFile("files", filepath.Base(path))
		require.NoError(t, err)
		_, _ = fw.Write([]byte(content))
		require.NoError(t, w.WriteField("paths", path))
	}
	require.NoError(t, w.Close())

	app := fiber.New()
	app.Post("/upload", h.Upload)
	req := httptest.NewRequest("POST", "/upload", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := app.Test(req, -1)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body struct {
		Uploaded []map[string]string `json:"uploaded"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	return body.Uploaded
}

func newTestLibrary(t *testing.T) (*Library, string) {
	t.Helper()
	d, err := db.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { d.Close() })
	dir := t.TempDir()
	s, err := library.NewScanner([]string{dir}, []string{".mp3"}, d)
	require.NoError(t, err)
	return &Library{Scanner: s, UploadDir: dir}, dir
}

func TestUploadKeepsFolderStructure(t *testing.T) {
	h, dir := newTestLibrary(t)

	results := upload(t, h, map[string]string{
		"My Album/01 Intro.mp3":   "a",
		"My Album/CD2/02 End.mp3": "b",
		"../evil.mp3":             "x",
	})
	require.Len(t, results, 3)

	errs := map[string]string{}
	for _, r := range results {
		errs[r["name"]] = r["error"]
	}
	require.Empty(t, errs["My Album/01 Intro.mp3"])
	require.Empty(t, errs["My Album/CD2/02 End.mp3"])
	require.Equal(t, "invalid path", errs["../evil.mp3"])

	got, err := os.ReadFile(filepath.Join(dir, "My Album", "01 Intro.mp3"))
	require.NoError(t, err)
	require.Equal(t, "a", string(got))
	_, err = os.Stat(filepath.Join(dir, "My Album", "CD2", "02 End.mp3"))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(filepath.Dir(dir), "evil.mp3"))
	require.True(t, os.IsNotExist(err), "file escaped the upload dir")
}

func TestUploadWithoutPathsStaysFlat(t *testing.T) {
	h, dir := newTestLibrary(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("files", "single.mp3")
	_, _ = fw.Write([]byte("s"))
	require.NoError(t, w.Close())

	app := fiber.New()
	app.Post("/upload", h.Upload)
	req := httptest.NewRequest("POST", "/upload", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := app.Test(req, -1)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	_, err = os.Stat(filepath.Join(dir, "single.mp3"))
	require.NoError(t, err)
}

func TestDeleteMany(t *testing.T) {
	d, err := db.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { d.Close() })
	dir, err := filepath.Abs(t.TempDir())
	require.NoError(t, err)

	// Seed files + index rows directly (a real scan needs ffprobe).
	paths := map[string]string{
		"a": filepath.Join(dir, "Album", "a.mp3"),
		"b": filepath.Join(dir, "Album", "CD2", "b.mp3"),
		"c": filepath.Join(dir, "c.mp3"),
		"d": filepath.Join(dir, "d.mp3"),
	}
	for id, p := range paths {
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o750))
		require.NoError(t, os.WriteFile(p, []byte("x"), 0o640))
		_, err := d.Exec(`INSERT INTO tracks (id, path, title, artist, album, genre, duration_ms, bitrate_kbps, size_bytes, folder, added_at, mtime_unix)
			VALUES (?, ?, 't', '', '', '', 0, 0, 1, '', '2026-01-01T00:00:00Z', 0)`, id, p)
		require.NoError(t, err)
	}
	s, err := library.NewScanner([]string{dir}, []string{".mp3"}, d)
	require.NoError(t, err)
	pm, err := playlist.NewManager(d)
	require.NoError(t, err)
	h := &Library{Scanner: s, Playlists: pm, UploadDir: dir}
	pl, err := pm.Create(playlist.CreateRequest{Name: "P", TrackPaths: []string{paths["a"], paths["c"], paths["d"]}})
	require.NoError(t, err)

	app := fiber.New()
	app.Post("/delete", h.DeleteMany)
	req := httptest.NewRequest("POST", "/delete",
		strings.NewReader(`{"folders":["Album"],"track_ids":["a","c","missing"]}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var body struct {
		DeletedTracks    int                 `json:"deleted_tracks"`
		DeletedFolders   int                 `json:"deleted_folders"`
		PlaylistsUpdated int                 `json:"playlists_updated"`
		Failed           []map[string]string `json:"failed"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, 3, body.DeletedTracks, "a+b via folder, c directly; a not double-counted")
	require.Equal(t, 1, body.DeletedFolders)
	require.Equal(t, 1, body.PlaylistsUpdated)
	require.Len(t, body.Failed, 1)
	require.Equal(t, "missing", body.Failed[0]["item"])

	_, err = os.Stat(paths["d"])
	require.NoError(t, err, "unselected track must remain")
	got, _ := pm.Get(pl.ID)
	require.Equal(t, []string{paths["d"]}, got.TrackPaths)
}
