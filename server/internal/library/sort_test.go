package library

import (
	"slices"
	"testing"
)

func TestSortTracksNatural(t *testing.T) {
	paths := []string{
		"/m/Album/10 Ten.mp3",
		"/m/Album/2 Two.mp3",
		"/m/album b/01 One.mp3",
		"/m/Album/1 One.mp3",
		"/m/Album/a.mp3",
		"/m/Album/B.mp3",
	}
	tracks := make([]*Track, len(paths))
	for i, p := range paths {
		tracks[i] = &Track{Path: p}
	}
	sortTracks(tracks)
	got := make([]string, len(tracks))
	for i, tk := range tracks {
		got[i] = tk.Path
	}
	want := []string{
		"/m/Album/1 One.mp3",
		"/m/Album/2 Two.mp3",
		"/m/Album/10 Ten.mp3",
		"/m/Album/a.mp3",
		"/m/Album/B.mp3",
		"/m/album b/01 One.mp3",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}
