package studio

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicCatalogSourceAllowlist(t *testing.T) {
	if len(catalogSources) != 7 {
		t.Fatal("reference site has seven configured sources")
	}
	for id := range catalogSources {
		u, err := catalogAddress(id)
		if err != nil || !strings.HasSuffix(u, "/"+id+".json") {
			t.Fatal(id, err)
		}
	}
	for _, id := range []string{"../secrets", "https://localhost", "banana-prompt-quicker?token=KEY", ""} {
		if _, err := FetchPublicCatalog(context.Background(), id); err == nil {
			t.Fatal("arbitrary URL/source accepted")
		}
	}
}
func TestPublicCatalogReadNeverUsesCredentials(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Referer") != "" {
			t.Error("public read leaked credentials")
		}
		w.Write([]byte(`[{"id":"one","prompt":"  literal\ntext  "}]`))
	}))
	defer s.Close()
	text, err := readPublicCatalog(context.Background(), s.Client(), s.URL)
	if err != nil || !strings.Contains(text, `  literal\ntext  `) {
		t.Fatal("source text changed", err)
	}
}
func TestPublicCatalogReadRejectsBadResponses(t *testing.T) {
	for _, body := range []string{"null", "{}", "<html>failure</html>"} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
		_, err := readPublicCatalog(context.Background(), s.Client(), s.URL)
		s.Close()
		if err == nil {
			t.Fatal("bad source accepted")
		}
	}
}
func TestPublicCatalogCardPersistsPairingWithoutGenerating(t *testing.T) {
	e, _, _ := fixture(t, nil)
	p := samplePrompt()
	p.CatalogKey = "banana-prompt-quicker:original"
	p.PreviewURL = "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/apple.png"
	p.SourceURL = "https://github.com/glidea/banana-prompt-quicker#gallery"
	p.ReferenceImageURLs = []string{"https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/images/apple_ref1.jpg"}
	saved, err := e.SavePromptCard(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.SavePromptCard(p); !errors.Is(err, ErrPromptConflict) {
		t.Fatal("duplicate catalog accepted", err)
	}
	e.Close()
	again, err := Open(e.repo.root, e.secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	snapshot, err := again.Snapshot()
	if err != nil || len(snapshot.Jobs) != 0 || len(snapshot.Assets) != 0 || len(snapshot.PromptCards) != 1 {
		t.Fatal("unexpected writes", err)
	}
	got := snapshot.PromptCards[0]
	if got.PreviewURL != saved.PreviewURL || got.CatalogKey != p.CatalogKey || got.Prompt != p.Prompt || got.ReferenceImageURLs[0] != p.ReferenceImageURLs[0] {
		t.Fatal("source pairing lost")
	}
}
func TestPublicCatalogCardRejectsUnsafeLinks(t *testing.T) {
	e, _, _ := fixture(t, nil)
	for _, u := range []string{"file:///etc/passwd", "http://169.254.169.254/", "https://user:pass@github.com/x", "https://127.0.0.1/x", "https://evil.example/a.jpg"} {
		p := samplePrompt()
		p.PreviewURL = u
		if _, err := e.SavePromptCard(p); err == nil {
			t.Fatal("unsafe preview accepted", u)
		}
	}
	p := samplePrompt()
	p.CatalogKey = "../private"
	if _, err := e.SavePromptCard(p); err == nil {
		t.Fatal("unsafe catalog key accepted")
	}
}

func TestCatalogReferencesDoNotAliasSavedState(t *testing.T) {
	e, _, _ := fixture(t, nil)
	p := samplePrompt()
	p.ReferenceImageURLs = []string{"https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/images/apple_ref1.jpg"}
	saved, err := e.SavePromptCard(p)
	if err != nil {
		t.Fatal(err)
	}
	p.ReferenceImageURLs[0] = "https://evil.example/changed"
	snapshot, _ := e.Snapshot()
	if snapshot.PromptCards[0].ReferenceImageURLs[0] != saved.ReferenceImageURLs[0] {
		t.Fatal("input references aliased stored state")
	}
}
