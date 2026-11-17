package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

type forwardOutput struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (o *forwardOutput) Write(data []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.buffer.Write(data)
}

func (o *forwardOutput) events() []forwardEvent {
	o.mu.Lock()
	defer o.mu.Unlock()
	var events []forwardEvent
	for _, line := range strings.Split(strings.TrimSpace(o.buffer.String()), "\n") {
		var event forwardEvent
		if json.Unmarshal([]byte(line), &event) == nil {
			events = append(events, event)
		}
	}
	return events
}

// A viewer's browser with only the given codecs answers the forwarder's offer for a share with picture and sound.
func forwardViewer(t *testing.T, codecs ...webrtc.RTPCodecParameters) (*forwarder, *forwardOutput, webrtc.SessionDescription) {
	t.Helper()
	output := &forwardOutput{}
	forward, err := newForwarder(output)
	if err != nil {
		t.Fatal(err)
	}
	forward.handle(forwardCommand{Op: "uplink", Peer: "up", Source: "share", Picture: true, Sound: true})
	forward.handle(forwardCommand{Op: "downlink", Peer: "down", Source: "share", Picture: true, Sound: true})
	t.Cleanup(func() {
		forward.close("down")
		forward.close("up")
	})
	var offer *webrtc.SessionDescription
	for _, event := range output.events() {
		if event.Peer == "down" && event.Signal != nil && event.Signal.Description != nil {
			offer = event.Signal.Description
		}
	}
	if offer == nil {
		t.Fatalf("no offer: %+v", output.events())
	}
	media := &webrtc.MediaEngine{}
	for _, codec := range codecs {
		kind := webrtc.RTPCodecTypeVideo
		if codec.MimeType == webrtc.MimeTypeOpus {
			kind = webrtc.RTPCodecTypeAudio
		}
		if err := media.RegisterCodec(codec, kind); err != nil {
			t.Fatal(err)
		}
	}
	viewer, err := webrtc.NewAPI(webrtc.WithMediaEngine(media)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = viewer.Close() })
	if err := viewer.SetRemoteDescription(*offer); err != nil {
		t.Fatal(err)
	}
	answer, err := viewer.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := viewer.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	return forward, output, answer
}

var (
	viewerSound = webrtc.RTPCodecParameters{RTPCodecCapability: forwardSound, PayloadType: 111}
	viewerH264  = webrtc.RTPCodecParameters{RTPCodecCapability: forwardPicture, PayloadType: 102}
	viewerVP8   = webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		PayloadType:        96,
	}
)

func failed(output *forwardOutput, peer string) bool {
	for _, event := range output.events() {
		if event.Op == "failed" && event.Peer == peer {
			return true
		}
	}
	return false
}

// A viewer that can't decode H.264 refuses the picture; it gets Couch's fallback rather than sound over black.
func TestDownlinkWithoutPictureFails(t *testing.T) {
	forward, output, answer := forwardViewer(t, viewerVP8, viewerSound)
	forward.handle(forwardCommand{Op: "signal", Peer: "down", Signal: &forwardSignal{Description: &answer}})
	if !failed(output, "down") {
		t.Fatalf("a viewer that refused the picture wasn't failed: %+v", output.events())
	}
}

func TestDownlinkWithPictureConnects(t *testing.T) {
	forward, output, answer := forwardViewer(t, viewerH264, viewerSound)
	forward.handle(forwardCommand{Op: "signal", Peer: "down", Signal: &forwardSignal{Description: &answer}})
	if failed(output, "down") {
		t.Fatalf("an H.264 viewer was failed: %+v", output.events())
	}
}

// An admitted viewer can't grow the ICE agent's candidates (and the pairs it checks) without bound.
func TestCandidatesPerPeerAreBounded(t *testing.T) {
	forward, _, answer := forwardViewer(t, viewerH264, viewerSound)
	forward.handle(forwardCommand{Op: "signal", Peer: "down", Signal: &forwardSignal{Description: &answer}})
	sent := 3 * forwardCandidates
	for port := range sent {
		candidate := webrtc.ICECandidateInit{
			Candidate: fmt.Sprintf("candidate:%d 1 udp 2130706431 192.0.2.1 %d typ host", port, 10000+port),
		}
		forward.handle(forwardCommand{Op: "signal", Peer: "down", Signal: &forwardSignal{Candidate: &candidate}})
	}
	forward.mu.Lock()
	connection := forward.peers["down"].connection
	forward.mu.Unlock()
	remote := 0
	// Pion adds remote candidates on its own goroutine.
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline) && remote < sent; time.Sleep(50 * time.Millisecond) {
		remote = 0
		for _, stats := range connection.GetStats() {
			if candidate, ok := stats.(webrtc.ICECandidateStats); ok && candidate.Type == webrtc.StatsTypeRemoteCandidate {
				remote++
			}
		}
	}
	if remote > forwardCandidates {
		t.Fatalf("%d remote candidates, want at most %d", remote, forwardCandidates)
	}
}
