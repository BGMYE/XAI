package studio

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func samplePrompt() PromptCard {
	return PromptCard{Title: "晨光雪山", Prompt: "  雪山与湖泊\r\n柔和自然光。\n<script>test</script>  ", Kind: "image", Category: "摄影", Tags: []string{"风景", " 风景 ", "自然光"}}
}
func TestPromptLibraryLegacyMigrationAndRestart(t *testing.T) {
	root := t.TempDir()
	d := emptyDocument()
	b, _ := json.Marshal(d)
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	delete(raw, "promptCards")
	b, _ = json.Marshal(raw)
	if err := os.WriteFile(filepath.Join(root, "studio.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	secrets := &memorySecrets{m: map[string]string{}}
	e, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	p, err := e.SavePromptCard(samplePrompt())
	if err != nil {
		t.Fatal(err)
	}
	if p.Revision != 1 || len(p.Tags) != 2 || p.Prompt != samplePrompt().Prompt {
		t.Fatal("prompt changed")
	}
	e.Close()
	e, err = Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	s, err := e.Snapshot()
	if err != nil || len(s.PromptCards) != 1 || s.PromptCards[0].Prompt != p.Prompt {
		t.Fatal("restart lost card", err)
	}
	s.PromptCards[0].Tags[0] = "tampered"
	again, _ := e.Snapshot()
	if again.PromptCards[0].Tags[0] == "tampered" {
		t.Fatal("snapshot aliased database")
	}
}
func TestPromptRevisionsAndDiskFailure(t *testing.T) {
	e, _, _ := fixture(t, nil)
	p, err := e.SavePromptCard(samplePrompt())
	if err != nil {
		t.Fatal(err)
	}
	old := p
	p.Favorite = true
	p, err = e.SavePromptCard(p)
	if err != nil || p.Revision != 2 {
		t.Fatal(err)
	}
	if _, err = e.SavePromptCard(old); !errors.Is(err, ErrPromptConflict) {
		t.Fatal("stale save accepted", err)
	}
	if err = e.DeletePromptCard(p.ID, old.Revision); !errors.Is(err, ErrPromptConflict) {
		t.Fatal("stale delete accepted", err)
	}
	e.mu.Lock()
	root := e.repo.root
	e.repo.root = filepath.Join(root, "missing")
	e.mu.Unlock()
	p.Prompt = "must not publish"
	_, err = e.SavePromptCard(p)
	e.mu.Lock()
	e.repo.root = root
	e.mu.Unlock()
	if err == nil {
		t.Fatal("ignored disk failure")
	}
	s, _ := e.Snapshot()
	if s.PromptCards[0].Prompt == p.Prompt {
		t.Fatal("uncommitted draft published")
	}
}
func TestPromptDeletionPreservesAssetAndCanvas(t *testing.T) {
	e, _, project := fixture(t, nil)
	a, err := e.Import(pixel(), "reference.png")
	if err != nil {
		t.Fatal(err)
	}
	project.Nodes = []Node{{ID: "node", Kind: "asset", Title: "作品", AssetID: a.ID}}
	if _, err = e.SaveProject(project); err != nil {
		t.Fatal(err)
	}
	p := samplePrompt()
	p.PreviewAssetID = a.ID
	p, err = e.SavePromptCard(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.DeletePromptCard(p.ID, p.Revision); err != nil {
		t.Fatal(err)
	}
	s, _ := e.Snapshot()
	if len(s.PromptCards) != 0 || len(s.Assets) != 1 || len(s.Projects[0].Nodes) != 1 {
		t.Fatal("deleted underlying data")
	}
	if _, err = os.Stat(filepath.Join(e.repo.root, "media", a.FileName)); err != nil {
		t.Fatal(err)
	}
}
func TestPromptImportAtomicAndPortable(t *testing.T) {
	e, _, _ := fixture(t, nil)
	good := samplePrompt()
	bad := samplePrompt()
	bad.Prompt = " "
	if _, err := e.ImportPromptCards([]PromptCard{good, bad}); err == nil {
		t.Fatal("bad batch accepted")
	}
	s, _ := e.Snapshot()
	if len(s.PromptCards) != 0 {
		t.Fatal("partially imported")
	}
	good.ID = "foreign"
	good.PreviewAssetID = "foreign-asset"
	good.SourceJobID = "foreign-job"
	good.Favorite = true
	good.Revision = 999
	imported, err := e.ImportPromptCards([]PromptCard{good})
	if err != nil {
		t.Fatal(err)
	}
	p := imported[0]
	if p.ID == good.ID || p.PreviewAssetID != "" || p.SourceJobID != "" || p.Favorite || p.Revision != 1 {
		t.Fatal("foreign bindings trusted")
	}
	if p.Prompt != good.Prompt {
		t.Fatal("import changed original text")
	}
}
func TestPromptInputsAndReferences(t *testing.T) {
	e, _, _ := fixture(t, nil)
	for _, alter := range []func(*PromptCard){
		func(p *PromptCard) { p.PreviewAssetID = "../../studio.json" },
		func(p *PromptCard) { p.PreviewAssetID = "unknown" },
		func(p *PromptCard) { p.SourceJobID = "invented" },
		func(p *PromptCard) { p.Kind = "script" },
		func(p *PromptCard) { p.Prompt = strings.Repeat("中", 6000) },
		func(p *PromptCard) { p.Tags = make([]string, 13) },
		func(p *PromptCard) { p.Parameters.Seconds = -1 },
		func(p *PromptCard) { p.Title = " " },
	} {
		p := samplePrompt()
		alter(&p)
		if _, err := e.SavePromptCard(p); err == nil {
			t.Fatal("invalid card accepted", p.ID)
		}
	}
	s, _ := e.Snapshot()
	if len(s.PromptCards) != 0 {
		t.Fatal("invalid rows persisted")
	}
}
func TestPromptConcurrentUpdates(t *testing.T) {
	e, _, _ := fixture(t, nil)
	p, err := e.SavePromptCard(samplePrompt())
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := e.SavePromptCard(p); results <- err }()
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrPromptConflict) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("expected one durable edit, got %d", success)
	}
}
func TestPromptCorruptionPreservesOriginalFile(t *testing.T) {
	root := t.TempDir()
	d := emptyDocument()
	p := samplePrompt()
	p.ID = "good"
	p.Kind = "bad"
	d.PromptCards[p.ID] = p
	b, _ := json.Marshal(d)
	path := filepath.Join(root, "studio.json")
	_ = os.WriteFile(path, b, 0600)
	if e, err := Open(root, &memorySecrets{m: map[string]string{}}, Options{}); err == nil {
		e.Close()
		t.Fatal("corrupt card accepted")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(b) {
		t.Fatal("corrupt store overwritten")
	}
}

func TestPromptGeneratedSourceDeduplicatesWithoutNewRequests(t *testing.T) {
	var requests atomic.Int32
	e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		requests.Add(1)
		return Output{Data: pixel()}, nil
	}))
	if _, err := e.Submit(req("source-job")); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, "source-job", "succeeded")
	p := samplePrompt()
	p.SourceJobID = j.ID
	p.PreviewAssetID = j.ResultAssetID
	p.Favorite = true
	saved, err := e.SavePromptCard(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.SavePromptCard(p); !errors.Is(err, ErrPromptConflict) {
		t.Fatal("duplicate source accepted", err)
	}
	if err = e.DeletePromptCard(saved.ID, saved.Revision); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 {
		t.Fatal("library operation created a paid request")
	}
	s, _ := e.Snapshot()
	if len(s.Assets) != 1 || len(s.Jobs) != 1 || s.Jobs[0].State != "succeeded" {
		t.Fatal("source was lost")
	}
}
