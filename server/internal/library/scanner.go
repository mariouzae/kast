// Package library scans directories for audio files and reads their metadata.
package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Track represents a single audio file in the library.
type Track struct {
	ID             string    `json:"id"`
	Path           string    `json:"path"`
	Title          string    `json:"title"`
	Artist         string    `json:"artist"`
	Album          string    `json:"album"`
	Genre          string    `json:"genre"`
	DurationMs     int64     `json:"duration_ms"`
	Bitrate        int       `json:"bitrate_kbps"`
	SizeBytes      int64     `json:"size_bytes"`
	Folder         string    `json:"folder"`
	// RelFolder is Folder relative to its library root ("" = top level), using
	// "/" separators. With several scan dirs it is prefixed by the root's name.
	// Computed on load/scan; not persisted.
	RelFolder string `json:"rel_folder"`
	AddedAt        time.Time `json:"added_at"`
	HasOverride    bool      `json:"has_override"`
	OriginalTitle  string    `json:"original_title,omitempty"`
	OriginalArtist string    `json:"original_artist,omitempty"`
	OriginalAlbum  string    `json:"original_album,omitempty"`
	OriginalGenre  string    `json:"original_genre,omitempty"`
	MtimeUnix      int64     `json:"-"`
}

// Scanner manages the in-memory track list and background scanning.
type Scanner struct {
	mu         sync.RWMutex
	tracks     []*Track
	scanDirs   []string
	extensions []string
	db         *sql.DB
}

// NewScanner creates a Scanner backed by db.
func NewScanner(scanDirs, extensions []string, db *sql.DB) (*Scanner, error) {
	s := &Scanner{
		scanDirs:   scanDirs,
		extensions: extensions,
		db:         db,
	}
	if err := s.load(); err != nil {
		slog.Warn("library: load from db failed", "err", err)
	}
	return s, nil
}

// PrimaryUploadDir returns the first configured scan directory.
func (s *Scanner) PrimaryUploadDir() string {
	if len(s.scanDirs) > 0 {
		return s.scanDirs[0]
	}
	return "./data/music"
}

// Tracks returns a copy of the current track list.
func (s *Scanner) Tracks() []*Track {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Track, len(s.tracks))
	copy(out, s.tracks)
	return out
}

// UpdateTrack persists a metadata override for the track with the given ID
// and updates the in-memory record immediately. Overrides survive re-scans.
func (s *Scanner) UpdateTrack(id, title, artist, album, genre string) (*Track, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var target *Track
	for _, t := range s.tracks {
		if t.ID == id {
			target = t
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("track not found: %s", id)
	}

	if _, err := s.db.Exec(`
		INSERT INTO track_overrides (path, title, artist, album, genre)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			title  = excluded.title,
			artist = excluded.artist,
			album  = excluded.album,
			genre  = excluded.genre`,
		target.Path, title, artist, album, genre,
	); err != nil {
		return nil, fmt.Errorf("library: update track: %w", err)
	}

	if !target.HasOverride {
		target.OriginalTitle  = target.Title
		target.OriginalArtist = target.Artist
		target.OriginalAlbum  = target.Album
		target.OriginalGenre  = target.Genre
		target.HasOverride    = true
	}
	target.Title  = title
	target.Artist = artist
	target.Album  = album
	target.Genre  = genre

	out := *target
	return &out, nil
}

// ErrTrackNotFound is returned when no track has the requested ID.
var ErrTrackNotFound = errors.New("track not found")

// DeleteTrack removes the track with the given ID from the library: the audio
// file is deleted from disk, its index and metadata-override rows are removed,
// and any folders left empty by the deletion are pruned (never the scan root).
// The file must live inside one of the scanner's directories.
func (s *Scanner) DeleteTrack(id string) (*Track, error) {
	s.mu.Lock()
	idx := slices.IndexFunc(s.tracks, func(t *Track) bool { return t.ID == id })
	if idx < 0 {
		s.mu.Unlock()
		return nil, ErrTrackNotFound
	}
	target := s.tracks[idx]
	root := s.rootFor(target.Path)
	if root == "" {
		s.mu.Unlock()
		return nil, fmt.Errorf("library: refusing to delete file outside library folders: %s", target.Path)
	}
	if err := os.Remove(target.Path); err != nil && !os.IsNotExist(err) {
		s.mu.Unlock()
		return nil, fmt.Errorf("library: delete file: %w", err)
	}
	s.tracks = slices.Delete(slices.Clone(s.tracks), idx, idx+1)
	if _, err := s.db.Exec("DELETE FROM tracks WHERE id = ?", id); err != nil {
		slog.Warn("library: delete track row", "id", id, "err", err)
	}
	if _, err := s.db.Exec("DELETE FROM track_overrides WHERE path = ?", target.Path); err != nil {
		slog.Warn("library: delete override row", "path", target.Path, "err", err)
	}
	s.mu.Unlock()

	// Prune now-empty parent folders up to (not including) the scan root.
	// os.Remove fails on non-empty directories, which ends the walk.
	for dir := filepath.Dir(target.Path); dir != root && strings.HasPrefix(dir, root+string(filepath.Separator)); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			break
		}
	}

	slog.Info("library: track deleted", "path", target.Path)
	out := *target
	return &out, nil
}

// ErrFolderNotFound is returned when a relative folder does not exist.
var ErrFolderNotFound = errors.New("folder not found")

// resolveRelFolder maps a RelFolder value (see Track.RelFolder) to an absolute
// directory inside one of the scan dirs. The library root itself ("") and any
// path that would escape a scan dir are rejected.
func (s *Scanner) resolveRelFolder(rel string) (abs, root string, err error) {
	if rel == "" || strings.HasPrefix(rel, "/") || strings.Contains(rel, "\\") {
		return "", "", ErrFolderNotFound
	}
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." || part == ".." {
			return "", "", ErrFolderNotFound
		}
	}
	multi := len(s.scanDirs) > 1
	for _, dir := range s.scanDirs {
		r, err := filepath.Abs(filepath.Clean(dir))
		if err != nil {
			continue
		}
		sub := rel
		if multi {
			prefix := filepath.Base(r) + "/"
			if !strings.HasPrefix(rel, prefix) {
				continue
			}
			sub = strings.TrimPrefix(rel, prefix)
		}
		candidate := filepath.Join(r, filepath.FromSlash(sub))
		if relCheck, err := filepath.Rel(r, candidate); err != nil || relCheck == "." || strings.HasPrefix(relCheck, "..") {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, r, nil
		}
	}
	return "", "", ErrFolderNotFound
}

// DeleteFolder deletes a library folder (given as a RelFolder value) from disk,
// including subfolders and any non-audio files in it, and drops every track
// inside it from the index. Empty parent folders are pruned up to the scan
// root. It returns the tracks that were removed.
func (s *Scanner) DeleteFolder(rel string) ([]*Track, error) {
	abs, root, err := s.resolveRelFolder(rel)
	if err != nil {
		return nil, err
	}
	inside := func(t *Track) bool { return strings.HasPrefix(t.Path, abs+string(filepath.Separator)) }

	s.mu.Lock()
	if err := os.RemoveAll(abs); err != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("library: delete folder: %w", err)
	}
	var removed []*Track
	kept := make([]*Track, 0, len(s.tracks))
	for _, t := range s.tracks {
		if inside(t) {
			cp := *t
			removed = append(removed, &cp)
		} else {
			kept = append(kept, t)
		}
	}
	s.tracks = kept
	for _, t := range removed {
		if _, err := s.db.Exec("DELETE FROM tracks WHERE id = ?", t.ID); err != nil {
			slog.Warn("library: delete track row", "id", t.ID, "err", err)
		}
		if _, err := s.db.Exec("DELETE FROM track_overrides WHERE path = ?", t.Path); err != nil {
			slog.Warn("library: delete override row", "path", t.Path, "err", err)
		}
	}
	s.mu.Unlock()

	for dir := filepath.Dir(abs); dir != root && strings.HasPrefix(dir, root+string(filepath.Separator)); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			break
		}
	}
	slog.Info("library: folder deleted", "path", abs, "tracks", len(removed))
	return removed, nil
}

// rootFor returns the absolute scan directory containing path, or "" if the
// path is not inside any of them.
func (s *Scanner) rootFor(path string) string {
	for _, dir := range s.scanDirs {
		abs, err := filepath.Abs(filepath.Clean(dir))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(abs, path)
		if err == nil && rel != "." && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
			return abs
		}
	}
	return ""
}

// DeleteOverride removes the stored override for the track with the given ID
// and restores the original (file-read) metadata in memory.
func (s *Scanner) DeleteOverride(id string) (*Track, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var target *Track
	for _, t := range s.tracks {
		if t.ID == id {
			target = t
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("track not found: %s", id)
	}

	if _, err := s.db.Exec(`DELETE FROM track_overrides WHERE path = ?`, target.Path); err != nil {
		return nil, fmt.Errorf("library: delete override: %w", err)
	}

	if target.HasOverride {
		target.Title  = target.OriginalTitle
		target.Artist = target.OriginalArtist
		target.Album  = target.OriginalAlbum
		target.Genre  = target.OriginalGenre
		target.OriginalTitle  = ""
		target.OriginalArtist = ""
		target.OriginalAlbum  = ""
		target.OriginalGenre  = ""
		target.HasOverride    = false
	}

	out := *target
	return &out, nil
}

// setRelFoldersLocked fills RelFolder for each track from its library root.
func (s *Scanner) setRelFoldersLocked(tracks []*Track) {
	multi := len(s.scanDirs) > 1
	for _, t := range tracks {
		root := s.rootFor(t.Path)
		if root == "" {
			t.RelFolder = ""
			continue
		}
		rel, err := filepath.Rel(root, filepath.Dir(t.Path))
		if err != nil || rel == "." {
			rel = ""
		}
		rel = filepath.ToSlash(rel)
		if multi {
			rel = strings.TrimSuffix(filepath.Base(root)+"/"+rel, "/")
		}
		t.RelFolder = rel
	}
}

// applyOverridesLocked merges stored metadata overrides into tracks.
// Must be called with s.mu held.
func (s *Scanner) applyOverridesLocked(tracks []*Track) {
	rows, err := s.db.Query(`SELECT path, title, artist, album, genre FROM track_overrides`)
	if err != nil {
		slog.Warn("library: load overrides", "err", err)
		return
	}
	defer rows.Close()

	type override struct{ title, artist, album, genre string }
	overrides := make(map[string]override)
	for rows.Next() {
		var path string
		var o override
		if err := rows.Scan(&path, &o.title, &o.artist, &o.album, &o.genre); err != nil {
			continue
		}
		overrides[path] = o
	}

	for _, t := range tracks {
		if o, ok := overrides[t.Path]; ok {
			t.OriginalTitle  = t.Title
			t.OriginalArtist = t.Artist
			t.OriginalAlbum  = t.Album
			t.OriginalGenre  = t.Genre
			t.HasOverride    = true
			t.Title  = o.title
			t.Artist = o.artist
			t.Album  = o.album
			t.Genre  = o.genre
		}
	}
}

type scanEntry struct {
	path  string
	mtime int64
}

// Scan walks all configured directories and updates the track list.
// Files whose mtime matches the cached value are reused without re-probing;
// new or changed files are probed with ffprobe in parallel.
func (s *Scanner) Scan(ctx context.Context) error {
	// Snapshot in-memory tracks for incremental matching (path → track).
	s.mu.RLock()
	existing := make(map[string]*Track, len(s.tracks))
	for _, t := range s.tracks {
		existing[t.Path] = t
	}
	s.mu.RUnlock()

	var (
		found    []*Track
		toProbe  []scanEntry
		now      = time.Now().UTC()
	)

	// Pass 1: walk — collect cache hits immediately, queue the rest for probing.
	for _, dir := range s.scanDirs {
		dir = filepath.Clean(dir)
		if abs, err := filepath.Abs(dir); err == nil {
			dir = abs
		}

		err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				slog.Warn("library: walk error", "path", path, "err", err)
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if d.IsDir() {
				return nil
			}

			ext := strings.ToLower(filepath.Ext(path))
			if !slices.Contains(s.extensions, ext) {
				return nil
			}

			rel, err := filepath.Rel(dir, path)
			if err != nil || strings.HasPrefix(rel, "..") {
				slog.Warn("library: skipping path outside scan dir", "path", path)
				return nil
			}

			info, err := d.Info()
			if err != nil {
				slog.Warn("library: stat failed", "path", path, "err", err)
				return nil
			}
			mtime := info.ModTime().Unix()

			if cached, ok := existing[path]; ok && cached.MtimeUnix == mtime {
				found = append(found, cached)
				return nil
			}
			toProbe = append(toProbe, scanEntry{path, mtime})
			return nil
		})
		if err != nil {
			return fmt.Errorf("library: scan %q: %w", dir, err)
		}
	}

	// Pass 2: probe new/changed files in parallel.
	cachedCount := len(found)
	if len(toProbe) > 0 {
		workers := runtime.NumCPU()
		sem := make(chan struct{}, workers)
		var (
			wg sync.WaitGroup
			mu sync.Mutex
		)
		for _, e := range toProbe {
			wg.Add(1)
			go func(e scanEntry) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				probeCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
				t, err := probeTrack(probeCtx, e.path, e.mtime, now)
				cancel()
				if err != nil {
					slog.Warn("library: probe failed", "path", e.path, "err", err)
					return
				}
				mu.Lock()
				found = append(found, t)
				mu.Unlock()
			}(e)
		}
		wg.Wait()
	}

	if err := s.persist(found); err != nil {
		slog.Error("library: persist after scan", "err", err)
	}

	s.mu.Lock()
	s.tracks = found
	s.applyOverridesLocked(found)
	s.setRelFoldersLocked(found)
	s.mu.Unlock()

	slog.Info("library: scan complete", "tracks", len(found), "cached", cachedCount, "probed", len(found)-cachedCount)
	return nil
}

// ── internal ──────────────────────────────────────────────────────────────────

func (s *Scanner) persist(tracks []*Track) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("library: persist begin tx: %w", err)
	}

	// Replace entire track index atomically.
	if _, err := tx.Exec("DELETE FROM tracks"); err != nil {
		tx.Rollback()
		return err
	}
	for _, t := range tracks {
		if _, err := tx.Exec(`
			INSERT INTO tracks (id, path, title, artist, album, genre, duration_ms, bitrate_kbps, size_bytes, folder, added_at, mtime_unix)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			t.ID, t.Path, t.Title, t.Artist, t.Album, t.Genre,
			t.DurationMs, t.Bitrate, t.SizeBytes, t.Folder,
			t.AddedAt.UTC().Format(time.RFC3339),
			t.MtimeUnix,
		); err != nil {
			slog.Warn("library: persist insert", "path", t.Path, "err", err)
		}
	}
	return tx.Commit()
}

func (s *Scanner) load() error {
	rows, err := s.db.Query(`
		SELECT id, path, title, artist, album, genre, duration_ms, bitrate_kbps, size_bytes, folder, added_at, mtime_unix
		FROM tracks`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var tracks []*Track
	for rows.Next() {
		var t Track
		var addedAt string
		if err := rows.Scan(
			&t.ID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.Genre,
			&t.DurationMs, &t.Bitrate, &t.SizeBytes, &t.Folder, &addedAt, &t.MtimeUnix,
		); err != nil {
			return err
		}
		t.AddedAt, _ = time.Parse(time.RFC3339, addedAt)
		tracks = append(tracks, &t)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.tracks = tracks
	s.applyOverridesLocked(tracks)
	s.setRelFoldersLocked(tracks)
	s.mu.Unlock()
	return nil
}

// ── ffprobe ───────────────────────────────────────────────────────────────────

type ffprobeOutput struct {
	Format struct {
		Filename string `json:"filename"`
		Duration string `json:"duration"`
		BitRate  string `json:"bit_rate"`
		Size     string `json:"size"`
		Tags     struct {
			Title  string `json:"title"`
			Artist string `json:"artist"`
			Album  string `json:"album"`
			Genre  string `json:"genre"`
		} `json:"tags"`
	} `json:"format"`
}

func probeTrack(ctx context.Context, path string, mtime int64, addedAt time.Time) (*Track, error) {
	// #nosec G204 — args are a fixed list; path is already cleaned and validated.
	var stderr strings.Builder
	cmd := exec.CommandContext(ctx,
		"ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		path,
	)
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			return nil, fmt.Errorf("ffprobe: %w", err)
		}
		return nil, fmt.Errorf("ffprobe: %w: %s", err, msg)
	}

	var probe ffprobeOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return nil, fmt.Errorf("ffprobe parse: %w", err)
	}

	f := probe.Format
	var durMs int64
	var dur float64
	fmt.Sscanf(f.Duration, "%f", &dur)
	durMs = int64(dur * 1000)

	var bitrate int
	fmt.Sscanf(f.BitRate, "%d", &bitrate)
	bitrate /= 1000

	var size int64
	fmt.Sscanf(f.Size, "%d", &size)

	title := f.Tags.Title
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}

	return &Track{
		ID:         trackID(),
		Path:       path,
		Title:      title,
		Artist:     f.Tags.Artist,
		Album:      f.Tags.Album,
		Genre:      f.Tags.Genre,
		DurationMs: durMs,
		Bitrate:    bitrate,
		SizeBytes:  size,
		Folder:     filepath.Dir(path),
		AddedAt:    addedAt,
		MtimeUnix:  mtime,
	}, nil
}

func trackID() string {
	return uuid.New().String()
}
