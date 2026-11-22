package library_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/riza/kast/internal/library"
	"github.com/stretchr/testify/require"
)

// seedTrack writes a file and an index row so NewScanner loads it without ffprobe.
func seedTrack(t *testing.T, d *sql.DB, id, path string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte("x"), 0o640))
	_, err := d.Exec(`INSERT INTO tracks (id, path, title, artist, album, genre, duration_ms, bitrate_kbps, size_bytes, folder, added_at, mtime_unix)
		VALUES (?, ?, 't', '', '', '', 0, 0, 1, '', '2026-01-01T00:00:00Z', 0)`, id, path)
	require.NoError(t, err)
}

func TestDeleteTrack_RemovesFileRowsAndEmptyFolders(t *testing.T) {
	d := testDB(t)
	root, err := filepath.Abs(t.TempDir())
	require.NoError(t, err)
	inAlbum := filepath.Join(root, "Album", "CD1", "a.mp3")
	keep := filepath.Join(root, "Album", "b.mp3")
	seedTrack(t, d, "a", inAlbum)
	seedTrack(t, d, "b", keep)
	_, err = d.Exec(`INSERT INTO track_overrides (path, title) VALUES (?, 'Custom')`, inAlbum)
	require.NoError(t, err)

	s, err := library.NewScanner([]string{root}, []string{".mp3"}, d)
	require.NoError(t, err)
	require.Len(t, s.Tracks(), 2)

	deleted, err := s.DeleteTrack("a")
	require.NoError(t, err)
	require.Equal(t, inAlbum, deleted.Path)

	_, err = os.Stat(inAlbum)
	require.True(t, os.IsNotExist(err), "file should be gone")
	_, err = os.Stat(filepath.Join(root, "Album", "CD1"))
	require.True(t, os.IsNotExist(err), "empty CD1 folder should be pruned")
	_, err = os.Stat(keep)
	require.NoError(t, err, "sibling track and its folder must stay")

	require.Len(t, s.Tracks(), 1)
	var n int
	require.NoError(t, d.QueryRow(`SELECT COUNT(*) FROM tracks WHERE id = 'a'`).Scan(&n))
	require.Zero(t, n)
	require.NoError(t, d.QueryRow(`SELECT COUNT(*) FROM track_overrides WHERE path = ?`, inAlbum).Scan(&n))
	require.Zero(t, n)

	// Deleting the last track in the root never removes the root itself.
	_, err = s.DeleteTrack("b")
	require.NoError(t, err)
	_, err = os.Stat(root)
	require.NoError(t, err, "scan root must not be removed")
}

func TestDeleteTrack_NotFound(t *testing.T) {
	s, err := library.NewScanner([]string{t.TempDir()}, []string{".mp3"}, testDB(t))
	require.NoError(t, err)
	_, err = s.DeleteTrack("nope")
	require.ErrorIs(t, err, library.ErrTrackNotFound)
}

func TestDeleteTrack_RefusesPathOutsideLibrary(t *testing.T) {
	d := testDB(t)
	outside := filepath.Join(t.TempDir(), "elsewhere.mp3")
	seedTrack(t, d, "x", outside)

	s, err := library.NewScanner([]string{t.TempDir()}, []string{".mp3"}, d)
	require.NoError(t, err)
	_, err = s.DeleteTrack("x")
	require.Error(t, err)
	_, statErr := os.Stat(outside)
	require.NoError(t, statErr, "file outside the library must not be deleted")
}

func TestRelFolder(t *testing.T) {
	d := testDB(t)
	root, err := filepath.Abs(t.TempDir())
	require.NoError(t, err)
	seedTrack(t, d, "top", filepath.Join(root, "top.mp3"))
	seedTrack(t, d, "nested", filepath.Join(root, "Road Trip", "CD2", "n.mp3"))

	s, err := library.NewScanner([]string{root}, []string{".mp3"}, d)
	require.NoError(t, err)
	got := map[string]string{}
	for _, tr := range s.Tracks() {
		got[tr.ID] = tr.RelFolder
	}
	require.Equal(t, "", got["top"])
	require.Equal(t, "Road Trip/CD2", got["nested"])
}

func TestDeleteFolder(t *testing.T) {
	d := testDB(t)
	root, err := filepath.Abs(t.TempDir())
	require.NoError(t, err)
	seedTrack(t, d, "a", filepath.Join(root, "Artist", "Album", "a.mp3"))
	seedTrack(t, d, "b", filepath.Join(root, "Artist", "Album", "CD2", "b.mp3"))
	seedTrack(t, d, "keep", filepath.Join(root, "Other", "k.mp3"))
	require.NoError(t, os.WriteFile(filepath.Join(root, "Artist", "Album", "cover.jpg"), []byte("img"), 0o640))

	s, err := library.NewScanner([]string{root}, []string{".mp3"}, d)
	require.NoError(t, err)

	removed, err := s.DeleteFolder("Artist/Album")
	require.NoError(t, err)
	require.Len(t, removed, 2)

	_, err = os.Stat(filepath.Join(root, "Artist", "Album"))
	require.True(t, os.IsNotExist(err), "folder incl. subfolder and cover.jpg should be gone")
	_, err = os.Stat(filepath.Join(root, "Artist"))
	require.True(t, os.IsNotExist(err), "now-empty parent should be pruned")
	_, err = os.Stat(filepath.Join(root, "Other", "k.mp3"))
	require.NoError(t, err, "other folders must be untouched")

	ids := []string{}
	for _, tr := range s.Tracks() {
		ids = append(ids, tr.ID)
	}
	require.Equal(t, []string{"keep"}, ids)
	var n int
	require.NoError(t, d.QueryRow(`SELECT COUNT(*) FROM tracks`).Scan(&n))
	require.Equal(t, 1, n)
}

func TestDeleteFolder_RejectsRootAndEscapes(t *testing.T) {
	d := testDB(t)
	parent := t.TempDir()
	root := filepath.Join(parent, "music")
	seedTrack(t, d, "a", filepath.Join(root, "x.mp3"))
	outside := filepath.Join(parent, "outside")
	require.NoError(t, os.MkdirAll(outside, 0o750))

	s, err := library.NewScanner([]string{root}, []string{".mp3"}, d)
	require.NoError(t, err)

	for _, bad := range []string{"", ".", "..", "../outside", "/etc", "a/../..", "missing"} {
		_, err := s.DeleteFolder(bad)
		require.ErrorIs(t, err, library.ErrFolderNotFound, bad)
	}
	_, err = os.Stat(filepath.Join(root, "x.mp3"))
	require.NoError(t, err)
	_, err = os.Stat(outside)
	require.NoError(t, err)
}
