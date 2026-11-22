package handler

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/riza/kast/internal/api/respond"
	"github.com/riza/kast/internal/library"
	"github.com/riza/kast/internal/playlist"
)

// Library groups library-related handlers.
type Library struct {
	Scanner   *library.Scanner
	Playlists *playlist.Manager // optional: deleted tracks are removed from playlists
	UploadDir string
}

// List godoc: GET /api/library
// Supports ?q= search and ?genre= filter.
func (h *Library) List(c *fiber.Ctx) error {
	tracks := h.Scanner.Tracks()
	q := strings.ToLower(c.Query("q"))
	genre := strings.ToLower(c.Query("genre"))

	if q == "" && genre == "" {
		return respond.OK(c, tracks)
	}

	var filtered []*library.Track
	for _, t := range tracks {
		if q != "" {
			haystack := strings.ToLower(t.Title + " " + t.Artist + " " + t.Album)
			if !strings.Contains(haystack, q) {
				continue
			}
		}
		if genre != "" && strings.ToLower(t.Genre) != genre {
			continue
		}
		filtered = append(filtered, t)
	}
	return respond.OK(c, filtered)
}

// allowedAudioExts is the set of extensions accepted for upload.
var allowedAudioExts = map[string]bool{
	".mp3": true, ".flac": true, ".ogg": true,
	".wav": true, ".aac": true, ".m4a": true, ".opus": true,
}

// errInvalidUploadPath is returned by cleanUploadPath for unsafe paths.
var errInvalidUploadPath = errors.New("invalid path")

// cleanUploadPath turns a client-supplied relative path such as
// "Album/CD1/01 Track.mp3" into a safe (dir, file) pair relative to the
// upload directory. It rejects absolute paths, "..", empty and hidden
// ("."-prefixed) components so uploads can never escape the upload dir.
func cleanUploadPath(rel string) (dir, name string, err error) {
	rel = strings.ReplaceAll(rel, "\\", "/")
	if strings.HasPrefix(rel, "/") {
		return "", "", errInvalidUploadPath
	}
	parts := strings.Split(rel, "/")
	if len(parts) > maxUploadDepth+1 {
		return "", "", errInvalidUploadPath
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".") {
			return "", "", errInvalidUploadPath
		}
	}
	return filepath.Join(parts[:len(parts)-1]...), parts[len(parts)-1], nil
}

// maxUploadDepth caps how many folder levels an uploaded path may contain.
const maxUploadDepth = 16

// Upload godoc: POST /api/library/upload
// Accepts multipart/form-data with field "files" (multiple files allowed).
// An optional "paths" field, repeated once per file in the same order, gives
// each file's path relative to the upload dir (e.g. "Album/01 Track.mp3");
// folders are created as needed so an uploaded folder keeps its structure.
func (h *Library) Upload(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return respond.Error(c, fiber.StatusBadRequest, "failed to parse form: "+err.Error())
	}

	uploadDir := h.UploadDir
	if uploadDir == "" {
		uploadDir = "./data/music"
	}
	if err := os.MkdirAll(uploadDir, 0o750); err != nil {
		return respond.Error(c, fiber.StatusInternalServerError, "failed to create upload directory")
	}

	files := form.File["files"]
	if len(files) == 0 {
		return respond.Error(c, fiber.StatusBadRequest, "no files provided")
	}

	type result struct {
		Name  string `json:"name"`
		Error string `json:"error,omitempty"`
	}
	results := make([]result, 0, len(files))

	paths := form.Value["paths"]

	for i, fh := range files {
		display := filepath.Base(fh.Filename)
		if i < len(paths) && paths[i] != "" {
			display = paths[i]
		}
		relDir, name, pathErr := cleanUploadPath(display)
		if pathErr != nil {
			results = append(results, result{Name: display, Error: "invalid path"})
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))

		if !allowedAudioExts[ext] {
			results = append(results, result{Name: display, Error: "unsupported format"})
			continue
		}

		dir := filepath.Join(uploadDir, relDir)
		if rel, err := filepath.Rel(uploadDir, dir); err != nil || strings.HasPrefix(rel, "..") {
			results = append(results, result{Name: display, Error: "invalid path"})
			continue
		}
		if err := os.MkdirAll(dir, 0o750); err != nil {
			results = append(results, result{Name: display, Error: "failed to create folder"})
			continue
		}

		src, err := fh.Open()
		if err != nil {
			results = append(results, result{Name: display, Error: "failed to open"})
			continue
		}

		dst := filepath.Join(dir, name)
		if _, statErr := os.Stat(dst); statErr == nil {
			base := strings.TrimSuffix(name, ext)
			dst = filepath.Join(dir, base+"_"+strconv.FormatInt(time.Now().UnixNano(), 36)+ext)
		}

		out, createErr := os.Create(dst)
		if createErr != nil {
			src.Close()
			results = append(results, result{Name: display, Error: "failed to create file"})
			continue
		}

		if _, copyErr := io.Copy(out, src); copyErr != nil {
			src.Close()
			out.Close()
			if removeErr := os.Remove(dst); removeErr != nil {
				slog.Warn("library: upload cleanup: remove failed", "path", dst, "err", removeErr)
			}
			results = append(results, result{Name: display, Error: "failed to write"})
			continue
		}
		src.Close()
		out.Close()

		slog.Info("library: uploaded", "file", dst)
		results = append(results, result{Name: display})
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := h.Scanner.Scan(ctx); err != nil {
			slog.Warn("library: post-upload scan failed", "err", err)
		}
	}()

	return respond.OK(c, fiber.Map{"uploaded": results})
}

// Delete godoc: DELETE /api/library/:id
// Deletes the track's audio file from disk, removes it from the library index
// and from every playlist that references it.
func (h *Library) Delete(c *fiber.Ctx) error {
	t, err := h.Scanner.DeleteTrack(c.Params("id"))
	if errors.Is(err, library.ErrTrackNotFound) {
		return respond.Error(c, fiber.StatusNotFound, "track not found")
	}
	if err != nil {
		slog.Error("library: delete", "id", c.Params("id"), "err", err)
		return respond.Error(c, fiber.StatusInternalServerError, "failed to delete track")
	}
	updated := 0
	if h.Playlists != nil {
		updated = h.Playlists.RemoveTrackPath(t.Path)
	}
	return respond.OK(c, fiber.Map{"deleted": t.ID, "playlists_updated": updated})
}

// DeleteFolder godoc: DELETE /api/library/folder?path=<rel_folder>
// Deletes a library folder (path as returned in a track's rel_folder) with all
// its files and subfolders, and removes its tracks from every playlist.
func (h *Library) DeleteFolder(c *fiber.Ctx) error {
	rel := c.Query("path")
	removed, err := h.Scanner.DeleteFolder(rel)
	if errors.Is(err, library.ErrFolderNotFound) {
		return respond.Error(c, fiber.StatusNotFound, "folder not found")
	}
	if err != nil {
		slog.Error("library: delete folder", "path", rel, "err", err)
		return respond.Error(c, fiber.StatusInternalServerError, "failed to delete folder")
	}
	updated := 0
	if h.Playlists != nil && len(removed) > 0 {
		paths := make([]string, len(removed))
		for i, t := range removed {
			paths[i] = t.Path
		}
		updated = h.Playlists.RemoveTrackPaths(paths)
	}
	return respond.OK(c, fiber.Map{"deleted_tracks": len(removed), "playlists_updated": updated})
}

// DeleteMany godoc: POST /api/library/delete
// Body: {"track_ids": [...], "folders": [...rel_folder]}. Deletes the given
// folders (with everything inside) and tracks, then removes all deleted tracks
// from playlists in one pass. Items that fail are reported in "failed"; a track
// that already went away with a selected folder is not an error.
func (h *Library) DeleteMany(c *fiber.Ctx) error {
	var body struct {
		TrackIDs []string `json:"track_ids"`
		Folders  []string `json:"folders"`
	}
	if err := c.BodyParser(&body); err != nil {
		return respond.Error(c, fiber.StatusBadRequest, "invalid JSON")
	}
	if len(body.TrackIDs) == 0 && len(body.Folders) == 0 {
		return respond.Error(c, fiber.StatusBadRequest, "nothing to delete")
	}

	type failure struct {
		Item  string `json:"item"`
		Error string `json:"error"`
	}
	var (
		failed         []failure
		removedPaths   []string
		removedIDs     = map[string]bool{}
		deletedFolders int
	)
	for _, rel := range body.Folders {
		removed, err := h.Scanner.DeleteFolder(rel)
		if err != nil {
			msg := "failed to delete folder"
			if errors.Is(err, library.ErrFolderNotFound) {
				msg = "folder not found"
			} else {
				slog.Error("library: bulk delete folder", "path", rel, "err", err)
			}
			failed = append(failed, failure{Item: rel, Error: msg})
			continue
		}
		deletedFolders++
		for _, t := range removed {
			removedIDs[t.ID] = true
			removedPaths = append(removedPaths, t.Path)
		}
	}
	for _, id := range body.TrackIDs {
		if removedIDs[id] {
			continue // already deleted as part of a selected folder
		}
		t, err := h.Scanner.DeleteTrack(id)
		if err != nil {
			msg := "failed to delete track"
			if errors.Is(err, library.ErrTrackNotFound) {
				msg = "track not found"
			} else {
				slog.Error("library: bulk delete track", "id", id, "err", err)
			}
			failed = append(failed, failure{Item: id, Error: msg})
			continue
		}
		removedIDs[t.ID] = true
		removedPaths = append(removedPaths, t.Path)
	}

	updated := 0
	if h.Playlists != nil && len(removedPaths) > 0 {
		updated = h.Playlists.RemoveTrackPaths(removedPaths)
	}
	if failed == nil {
		failed = []failure{}
	}
	return respond.OK(c, fiber.Map{
		"deleted_tracks":    len(removedPaths),
		"deleted_folders":   deletedFolders,
		"playlists_updated": updated,
		"failed":            failed,
	})
}

// Update godoc: PATCH /api/library/:id
// Updates metadata overrides (title, artist, album, genre) for a track.
func (h *Library) Update(c *fiber.Ctx) error {
	id := c.Params("id")
	var body struct {
		Title  string `json:"title"`
		Artist string `json:"artist"`
		Album  string `json:"album"`
		Genre  string `json:"genre"`
	}
	if err := c.BodyParser(&body); err != nil {
		return respond.Error(c, fiber.StatusBadRequest, "invalid JSON")
	}
	track, err := h.Scanner.UpdateTrack(id, body.Title, body.Artist, body.Album, body.Genre)
	if err != nil {
		return respond.Error(c, fiber.StatusNotFound, err.Error())
	}
	return respond.OK(c, track)
}

// Download godoc: GET /api/library/:id/download
// Streams the track's audio file as an attachment. Supports HTTP Range requests.
func (h *Library) Download(c *fiber.Ctx) error {
	track := findTrack(h.Scanner, c.Params("id"))
	if track == nil {
		return respond.Error(c, fiber.StatusNotFound, "track not found")
	}
	info, err := os.Stat(track.Path)
	if err != nil || !info.Mode().IsRegular() {
		slog.Warn("library: download: file missing", "id", track.ID, "path", track.Path, "err", err)
		return respond.Error(c, fiber.StatusNotFound, "track file not found")
	}
	return c.Download(track.Path, filepath.Base(track.Path))
}

// ResetOverride godoc: DELETE /api/library/:id/override
// Removes any stored metadata override, restoring the file's ID3 values.
func (h *Library) ResetOverride(c *fiber.Ctx) error {
	track, err := h.Scanner.DeleteOverride(c.Params("id"))
	if err != nil {
		return respond.Error(c, fiber.StatusNotFound, err.Error())
	}
	return respond.OK(c, track)
}

// Scan godoc: POST /api/library/scan
func (h *Library) Scan(c *fiber.Ctx) error {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := h.Scanner.Scan(ctx); err != nil {
			slog.Error("library: scan failed", "err", err)
		}
	}()
	return respond.OK(c, fiber.Map{"status": "scan started"})
}

// findTrack returns the library track with the given ID, or nil.
func findTrack(s *library.Scanner, id string) *library.Track {
	for _, t := range s.Tracks() {
		if t.ID == id {
			return t
		}
	}
	return nil
}
