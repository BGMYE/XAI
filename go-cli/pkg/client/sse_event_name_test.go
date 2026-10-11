package client

import "testing"

func TestIterEventsUsesEventNameAndMultilineData(t *testing.T) {
	raw := "event: error\r\ndata: {\"message\":\r\ndata: \"rejected\"}\r\n\r\nevent: response.completed\ndata:{\"type\":\"explicit\"}\n\n"
	var events []Event
	for e := range IterEvents(raw) {
		events = append(events, e)
	}
	if len(events) != 2 || events[0]["type"] != "error" || events[0]["message"] != "rejected" || events[1]["type"] != "explicit" {
		t.Fatalf("events: %+v", events)
	}
}
