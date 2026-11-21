package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/riza/kast/internal/autodj"
	"github.com/riza/kast/internal/library"
)

func tr(ids ...string) []*library.Track {
	out := make([]*library.Track, len(ids))
	for i, id := range ids {
		out[i] = &library.Track{ID: id}
	}
	return out
}

func ids(ts []*library.Track) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.ID
	}
	return out
}

func assertIDs(t *testing.T, got []*library.Track, want ...string) {
	t.Helper()
	g := ids(got)
	if len(g) != len(want) {
		t.Fatalf("got %v, want %v", g, want)
	}
	for i := range want {
		if g[i] != want[i] {
			t.Fatalf("got %v, want %v", g, want)
		}
	}
}

func TestPredictUpcoming_SequentialWraps(t *testing.T) {
	got := predictUpcoming(tr("a", "b", "c"), nil, tr("b", "a"), "b", false, 5)
	assertIDs(t, got, "c", "a", "b")
}

func TestPredictUpcoming_Limit(t *testing.T) {
	got := predictUpcoming(tr("a", "b", "c", "d"), nil, tr("a"), "a", false, 2)
	assertIDs(t, got, "b", "c")
}

func TestPredictUpcoming_QueueFirst(t *testing.T) {
	got := predictUpcoming(tr("a", "b", "c"), tr("x"), tr("a"), "a", false, 3)
	assertIDs(t, got, "x", "b", "c")
}

func TestPredictUpcoming_JingleOnAirUsesLastPlaylistTrack(t *testing.T) {
	// "j" is a jingle (not in the playlist); the cursor is still after "b".
	got := predictUpcoming(tr("a", "b", "c"), nil, tr("j", "b", "a"), "j", false, 2)
	assertIDs(t, got, "c", "a")
}

func TestPredictUpcoming_ShuffleStopsAtEndOfPass(t *testing.T) {
	got := predictUpcoming(tr("a", "b", "c"), nil, tr("b"), "b", true, 5)
	assertIDs(t, got, "c")
}

func TestPredictUpcoming_NoHistoryStartsAtTop(t *testing.T) {
	got := predictUpcoming(tr("a", "b"), nil, nil, "", false, 5)
	assertIDs(t, got, "a", "b")
}

func TestPredictUpcoming_ZeroLimit(t *testing.T) {
	if got := predictUpcoming(tr("a"), tr("x"), nil, "", false, 0); len(got) != 0 {
		t.Fatalf("expected empty, got %v", ids(got))
	}
}

func trd(ms int64, ids ...string) []*library.Track {
	out := tr(ids...)
	for _, t := range out {
		t.DurationMs = ms
	}
	return out
}

func TestPredictHorizon_WrapsUntilCovered(t *testing.T) {
	// 3 tracks of 100s, 450s wanted: 5 entries, wrapping the playlist.
	got := predictHorizon(trd(100_000, "a", "b", "c"), nil, tr("a"), "a", 450_000, 100)
	assertIDs(t, got, "b", "c", "a", "b", "c")
}

func TestPredictHorizon_QueueCounts(t *testing.T) {
	got := predictHorizon(trd(100_000, "a", "b"), trd(100_000, "x"), tr("a"), "a", 200_000, 100)
	assertIDs(t, got, "x", "b")
}

func TestPredictHorizon_ItemCapWithUnknownDurations(t *testing.T) {
	got := predictHorizon(tr("a", "b"), nil, nil, "", 86_400_000, 7)
	if len(got) != 7 {
		t.Fatalf("expected 7 entries, got %d", len(got))
	}
}

func TestPredictHorizon_AlreadyCovered(t *testing.T) {
	if got := predictHorizon(trd(100_000, "a"), nil, nil, "", 0, 100); len(got) != 0 {
		t.Fatalf("expected empty, got %v", ids(got))
	}
}

// ── Jingles ──────────────────────────────────────────────────────────────────

func dur(min int, ts ...*library.Track) []*library.Track {
	for _, t := range ts {
		t.DurationMs = int64(min) * 60_000
	}
	return ts
}

// planWithJingles runs plan the way the handler does: np is history[0],
// started at t0, and the next pick happens when it ends.
func planWithJingles(
	tracks, queue, history, pool []*library.Track,
	everyTracks, everyMinutes, limit int,
) []string {
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	np := history[0]
	cfg := autodj.JingleConfig{Tracks: pool, EveryTracks: everyTracks, EveryMinutes: everyMinutes}
	cad := newJingleCadence(cfg, history, np, t0)
	at := t0.Add(time.Duration(np.DurationMs) * time.Millisecond)
	got := plan(tracks, queue, history, np.ID, oneCycle, cad, at,
		func(n int, _ int64) bool { return n >= limit })
	out := make([]string, len(got))
	for i, p := range got {
		out[i] = p.track.ID
		if p.jingle {
			out[i] = "J:" + out[i]
		}
	}
	return out
}

func assertStrings(t *testing.T, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPlan_JingleEveryTracks_NoJingleInHistory(t *testing.T) {
	pl := tr("a", "b", "c")
	pool := tr("j1", "j2")
	// b on air after a: two tracks since the session (re)started.
	got := planWithJingles(pl, nil, []*library.Track{pl[1], pl[0]}, pool, 2, 0, 10)
	assertStrings(t, got, "J:j1", "c", "a", "J:j2", "b")
}

func TestPlan_JingleEveryTracks_ContinuesFromLastJingle(t *testing.T) {
	pl := tr("a", "b", "c")
	pool := tr("j1", "j2")
	// a on air, one track after j2: one more track, then j1 (pool rotates).
	got := planWithJingles(pl, nil, []*library.Track{pl[0], pool[1], pl[2]}, pool, 2, 0, 10)
	assertStrings(t, got, "b", "J:j1", "c", "a", "J:j2")
}

func TestPlan_JingleEveryMinutes(t *testing.T) {
	pl := dur(4, tr("a", "b", "c")...)
	pool := dur(1, tr("j1", "j2")...)
	// j1 started 1 min before a; the 10 min mark passes during c.
	got := planWithJingles(pl, nil, []*library.Track{pl[0], pool[0]}, pool, 0, 10, 5)
	assertStrings(t, got, "b", "c", "J:j2", "a")
}

func TestPlan_JingleOnAir(t *testing.T) {
	pl := tr("a", "b", "c")
	pool := tr("j")
	got := planWithJingles(pl, nil, []*library.Track{pool[0], pl[0]}, pool, 2, 0, 10)
	assertStrings(t, got, "b", "c", "J:j", "a")
}

func TestPlan_QueueSkipsJingleCheck(t *testing.T) {
	pl := tr("a", "b", "c")
	pool := tr("j")
	// The cadence is already due, but a queued insert still goes first.
	got := planWithJingles(pl, tr("x"), []*library.Track{pl[0], pool[0]}, pool, 1, 0, 3)
	assertStrings(t, got, "x", "J:j", "b")
}

func TestPlan_LimitCountsJingles(t *testing.T) {
	pl := tr("a", "b", "c")
	pool := tr("j")
	// Every track: a has played since j, so j is due straight away.
	got := planWithJingles(pl, nil, []*library.Track{pl[0], pool[0]}, pool, 1, 0, 3)
	assertStrings(t, got, "J:j", "b", "J:j")
}
