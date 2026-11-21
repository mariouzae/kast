package handler

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/riza/kast/internal/api/respond"
	"github.com/riza/kast/internal/autodj"
	"github.com/riza/kast/internal/djmanager"
	"github.com/riza/kast/internal/library"
	"github.com/riza/kast/internal/mount"
	"github.com/riza/kast/internal/playlist"
)

const (
	defaultSyncUpcoming = 5
	maxSyncUpcoming     = 20
	// maxSyncHorizonS caps ?horizon_s= at a week.
	maxSyncHorizonS = 7 * 24 * 3600
	// maxSyncHorizonItems bounds a horizon response however short the tracks
	// are (or if their durations are unknown).
	maxSyncHorizonItems = 3000
)

// Sync serves the download-and-play sync feed for client apps that do not
// listen to the HLS stream but mirror a mount locally: they download what is
// on air (and what comes next) and play the files themselves.
//
// It is read-only and built purely on top of what the AutoDJ already exposes.
type Sync struct {
	DJManager *djmanager.Manager
	Scanner   *library.Scanner
	Mounts    *mount.Manager
	Playlists *playlist.Manager
}

type syncTrack struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	DurationMs  int64  `json:"duration_ms"`
	SizeBytes   int64  `json:"size_bytes"`
	Format      string `json:"format"`
	DownloadURL string `json:"download_url"`
	// Kind is "track" for playlist and queued tracks, "jingle" for a track
	// from the mount's jingle/ad pool.
	Kind string `json:"kind"`
}

const (
	kindTrack  = "track"
	kindJingle = "jingle"
)

// syncJingles is the mount's jingle/ad rule. Pool is every jingle the AutoDJ
// can pick from, so a client can keep them all offline: where a jingle falls
// in "upcoming" is a prediction, the pool is not.
type syncJingles struct {
	EveryTracks  int         `json:"every_tracks"`
	EveryMinutes int         `json:"every_minutes"`
	Pool         []syncTrack `json:"pool"`
}

type syncNowPlaying struct {
	syncTrack
	StartedAt time.Time `json:"started_at"`
	ElapsedMs int64     `json:"elapsed_ms"`
}

type syncResponse struct {
	Mount      string          `json:"mount"`
	ServerTime time.Time       `json:"server_time"`
	PlaylistID string          `json:"playlist_id"`
	Mode       string          `json:"mode"`
	HorizonS   int             `json:"horizon_s,omitempty"`
	Jingles    *syncJingles    `json:"jingles"`
	NowPlaying *syncNowPlaying `json:"now_playing"`
	Upcoming   []syncTrack     `json:"upcoming"`
}

// Get godoc: GET /api/mounts/:name/sync?upcoming=5
// or:        GET /api/mounts/:name/sync?horizon_s=86400
//
// Returns the track on air with its live position, plus the tracks the AutoDJ
// is expected to play next, each with a download URL. With horizon_s, the
// upcoming list instead covers that much airtime (for apps that keep a day of
// audio offline). A mount with no AutoDJ session returns 200 with a null
// now_playing and an empty upcoming list.
func (h *Sync) Get(c *fiber.Ctx) error {
	mountName := "/" + c.Params("name")
	if _, err := h.Mounts.Get(mountName); err != nil {
		return respond.Error(c, fiber.StatusNotFound, "mount not found")
	}

	limit := c.QueryInt("upcoming", defaultSyncUpcoming)
	if limit < 0 {
		limit = 0
	}
	if limit > maxSyncUpcoming {
		limit = maxSyncUpcoming
	}
	horizonS := c.QueryInt("horizon_s", 0)
	if horizonS < 0 {
		horizonS = 0
	}
	if horizonS > maxSyncHorizonS {
		horizonS = maxSyncHorizonS
	}

	now := time.Now()
	resp := syncResponse{
		Mount:      mountName,
		ServerTime: now.UTC(),
		HorizonS:   horizonS,
		Upcoming:   []syncTrack{},
	}

	sess := h.DJManager.GetSession(mountName)
	if sess == nil {
		return respond.OK(c, resp)
	}
	resp.PlaylistID = sess.PlaylistID
	resp.Mode = "sequential"
	if pl, err := h.Playlists.Get(sess.PlaylistID); err == nil {
		resp.Mode = pl.Mode
	}

	tracks, nowPlayingID, queue := h.DJManager.Tracks(mountName)
	jcfg := h.jingleConfig(mountName)
	isJingle := jingleSet(jcfg)
	if jcfg.Enabled() {
		resp.Jingles = &syncJingles{
			EveryTracks:  jcfg.EveryTracks,
			EveryMinutes: jcfg.EveryMinutes,
			Pool:         make([]syncTrack, 0, len(jcfg.Tracks)),
		}
		for _, t := range jcfg.Tracks {
			resp.Jingles.Pool = append(resp.Jingles.Pool, toSyncTrack(t, kindJingle))
		}
	}

	np := h.DJManager.NowPlaying(mountName)
	since := now
	if np != nil {
		since = h.DJManager.NowPlayingSince(mountName)
		if since.IsZero() {
			since = now
		}
		elapsed := now.Sub(since).Milliseconds()
		if elapsed < 0 {
			elapsed = 0
		}
		if np.DurationMs > 0 && elapsed > np.DurationMs {
			elapsed = np.DurationMs
		}
		resp.NowPlaying = &syncNowPlaying{
			syncTrack: toSyncTrack(np, kindOf(np, isJingle)),
			StartedAt: since.UTC(),
			ElapsedMs: elapsed,
		}
	}

	history := h.DJManager.RecentTracks(mountName)
	var cadence *jingleCadence
	if jcfg.Enabled() {
		cadence = newJingleCadence(jcfg, history, np, since)
	}
	// The next pick happens when the current track ends.
	nextAt := now
	if resp.NowPlaying != nil {
		nextAt = since.Add(time.Duration(resp.NowPlaying.DurationMs) * time.Millisecond)
	}

	var upcoming []plannedTrack
	if horizonS > 0 {
		need := int64(horizonS) * 1000
		if resp.NowPlaying != nil {
			need -= resp.NowPlaying.DurationMs - resp.NowPlaying.ElapsedMs
		}
		upcoming = plan(tracks, queue, history, nowPlayingID, wrapForever, cadence, nextAt,
			func(n int, totalMs int64) bool { return totalMs >= need || n >= maxSyncHorizonItems })
	} else {
		upcoming = plan(tracks, queue, history, nowPlayingID, countBound(resp.Mode == "shuffle"), cadence, nextAt,
			func(n int, _ int64) bool { return n >= limit })
	}
	for _, p := range upcoming {
		kind := kindTrack
		if p.jingle {
			kind = kindJingle
		}
		resp.Upcoming = append(resp.Upcoming, toSyncTrack(p.track, kind))
	}
	return respond.OK(c, resp)
}

// jingleConfig is the mount's jingle rule resolved against the library, the
// same way the AutoDJ resolves it when a session starts.
func (h *Sync) jingleConfig(mountName string) autodj.JingleConfig {
	if h.Scanner == nil {
		return autodj.JingleConfig{}
	}
	all := h.Scanner.Tracks()
	byPath := make(map[string]*library.Track, len(all))
	for _, t := range all {
		byPath[t.Path] = t
	}
	return h.DJManager.ResolveJingles(mountName, byPath)
}

func jingleSet(cfg autodj.JingleConfig) map[string]bool {
	set := make(map[string]bool, len(cfg.Tracks))
	for _, t := range cfg.Tracks {
		set[t.ID] = true
	}
	return set
}

func kindOf(t *library.Track, isJingle map[string]bool) string {
	if isJingle[t.ID] {
		return kindJingle
	}
	return kindTrack
}

func toSyncTrack(t *library.Track, kind string) syncTrack {
	return syncTrack{
		ID:          t.ID,
		Title:       t.Title,
		Artist:      t.Artist,
		Album:       t.Album,
		DurationMs:  t.DurationMs,
		SizeBytes:   t.SizeBytes,
		Format:      strings.TrimPrefix(strings.ToLower(filepath.Ext(t.Path)), "."),
		DownloadURL: "/api/library/" + t.ID + "/download",
		Kind:        kind,
	}
}

// jingleCadence replays the AutoDJ's jingle rule (autodj.Player.nextTrack)
// forward in time. The player keeps its counters private, so they are rebuilt
// from the play history: the tracks since the last jingle, when that jingle
// started, and which jingle of the pool comes next.
type jingleCadence struct {
	pool         []*library.Track
	everyTracks  int
	everyMinutes int
	sinceJingle  int       // tracks started since the last jingle
	lastJingleAt time.Time // when the last jingle started
	next         int       // index into pool of the next jingle
}

// newJingleCadence rebuilds the cadence state. history is newest first and
// starts with the track on air (np, started at since).
//
// When the history holds no jingle (the session started recently, or more
// than ten tracks have played since), the oldest known start stands in for the
// last jingle and the pool is assumed to start at its first entry: the
// prediction then settles at the first jingle actually played.
func newJingleCadence(cfg autodj.JingleConfig, history []*library.Track, np *library.Track, since time.Time) *jingleCadence {
	c := &jingleCadence{
		pool:         cfg.Tracks,
		everyTracks:  cfg.EveryTracks,
		everyMinutes: cfg.EveryMinutes,
		lastJingleAt: since,
	}
	if np == nil {
		return c
	}
	if len(history) == 0 || history[0].ID != np.ID {
		history = append([]*library.Track{np}, history...)
	}
	poolIndex := make(map[string]int, len(cfg.Tracks))
	for i, t := range cfg.Tracks {
		poolIndex[t.ID] = i
	}
	start := since // start time of history[i]
	for i, t := range history {
		if i > 0 {
			start = start.Add(-time.Duration(t.DurationMs) * time.Millisecond)
		}
		if j, ok := poolIndex[t.ID]; ok {
			c.sinceJingle = i
			c.lastJingleAt = start
			c.next = (j + 1) % len(cfg.Tracks)
			return c
		}
	}
	c.sinceJingle = len(history)
	c.lastJingleAt = start
	return c
}

// due mirrors autodj.Player.shouldInsertJingleLocked at time at.
func (c *jingleCadence) due(at time.Time) bool {
	if c.everyTracks > 0 && c.sinceJingle >= c.everyTracks {
		return true
	}
	return c.everyMinutes > 0 && at.Sub(c.lastJingleAt) >= time.Duration(c.everyMinutes)*time.Minute
}

// pick mirrors autodj.Player.pickJingleLocked.
func (c *jingleCadence) pick(at time.Time) *library.Track {
	t := c.pool[c.next%len(c.pool)]
	c.next = (c.next + 1) % len(c.pool)
	c.sinceJingle = 0
	c.lastJingleAt = at
	return t
}

// playlistBound limits how far a plan follows the playlist.
type playlistBound int

const (
	// wrapForever wraps the playlist for as long as the plan asks.
	wrapForever playlistBound = iota
	// oneCycle stops once every playlist track has been planned once.
	oneCycle
	// untilPassEnd stops at the end of the playlist: in shuffle mode the
	// AutoDJ reshuffles there, so later order is unknown.
	untilPassEnd
)

type plannedTrack struct {
	track  *library.Track
	jingle bool
}

// plan works out what the AutoDJ will play after the current track, in the
// order autodj.Player.nextTrack picks it:
//
//  1. The one-shot queue (manual "play next" inserts), which always drains
//     first and skips the jingle check.
//  2. A jingle, when the cadence is due at that track's start time.
//  3. The playlist, continuing after the most recent playlist track in
//     history. History is used rather than the now-playing ID because the
//     current track may be a jingle or a queued insert, which do not move
//     the playlist cursor.
//
// cadence is nil when the mount has no jingle rule; at is when the next pick
// happens (the end of the current track). done is asked before each pick
// with the count and airtime planned so far, and bound limits how far into
// the playlist the plan goes.
func plan(
	tracks, queue, history []*library.Track,
	nowPlayingID string,
	bound playlistBound,
	cadence *jingleCadence,
	at time.Time,
	done func(n int, totalMs int64) bool,
) []plannedTrack {
	out := make([]plannedTrack, 0)
	var total int64
	add := func(t *library.Track, jingle bool) {
		out = append(out, plannedTrack{track: t, jingle: jingle})
		total += t.DurationMs
		at = at.Add(time.Duration(t.DurationMs) * time.Millisecond)
	}

	for _, t := range queue {
		if done(len(out), total) {
			return out
		}
		add(t, false)
		if cadence != nil {
			cadence.sinceJingle++
		}
	}
	if len(tracks) == 0 {
		return out
	}

	anchor := playlistAnchor(tracks, history, nowPlayingID)
	for step := 1; ; {
		if done(len(out), total) {
			return out
		}
		if cadence != nil && cadence.due(at) {
			add(cadence.pick(at), true)
			continue
		}
		i := anchor + step
		if (bound == untilPassEnd && i >= len(tracks)) || (bound == oneCycle && step > len(tracks)) {
			return out
		}
		add(tracks[i%len(tracks)], false)
		if cadence != nil {
			cadence.sinceJingle++
		}
		step++
	}
}

// predictUpcoming is plan without jingles, bounded by a track count.
func predictUpcoming(
	tracks, queue, history []*library.Track,
	nowPlayingID string,
	shuffle bool,
	limit int,
) []*library.Track {
	if limit <= 0 {
		return nil
	}
	return trackList(plan(tracks, queue, history, nowPlayingID, countBound(shuffle), nil, time.Time{},
		func(n int, _ int64) bool { return n >= limit }))
}

// predictHorizon is plan without jingles, bounded by airtime.
func predictHorizon(
	tracks, queue, history []*library.Track,
	nowPlayingID string,
	horizonMs int64,
	maxItems int,
) []*library.Track {
	return trackList(plan(tracks, queue, history, nowPlayingID, wrapForever, nil, time.Time{},
		func(n int, totalMs int64) bool { return totalMs >= horizonMs || n >= maxItems }))
}

// countBound is how far a count-limited (?upcoming=N) plan goes: one cycle,
// or the rest of the current pass in shuffle mode.
func countBound(shuffle bool) playlistBound {
	if shuffle {
		return untilPassEnd
	}
	return oneCycle
}

func trackList(p []plannedTrack) []*library.Track {
	out := make([]*library.Track, len(p))
	for i, x := range p {
		out[i] = x.track
	}
	return out
}

// playlistAnchor is the index of the playlist track the AutoDJ cursor sits
// after: the most recent playlist track in history (the current track may be
// a jingle or a queued insert, which do not move the cursor), falling back to
// the now-playing track, or -1 when nothing from the playlist has played.
func playlistAnchor(tracks, history []*library.Track, nowPlayingID string) int {
	pos := make(map[string]int, len(tracks))
	for i, t := range tracks {
		if _, seen := pos[t.ID]; !seen {
			pos[t.ID] = i
		}
	}
	for _, t := range history {
		if i, ok := pos[t.ID]; ok {
			return i
		}
	}
	if i, ok := pos[nowPlayingID]; ok && nowPlayingID != "" {
		return i
	}
	return -1
}
