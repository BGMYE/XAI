package studio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func registry(t *testing.T) (*Engine, *memorySecrets) {
	t.Helper()
	secrets := &memorySecrets{m: map[string]string{}}
	e, err := Open(t.TempDir(), secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return e, secrets
}

func upstream(id string) Profile {
	return Profile{ID: id, Name: "上游 " + id, BaseURL: "https://relay.example.com/v1", Protocol: "openai", ImageModel: "gpt-image-test"}
}

func TestReenteringTheSavedKeyKeepsItsSlot(t *testing.T) {
	e, secrets := registry(t)
	first, err := e.SaveProfile(upstream("a"), "KEY-1")
	if err != nil {
		t.Fatal(err)
	}
	again, err := e.SaveProfile(first, "KEY-1")
	if err != nil || again.CredentialID != first.CredentialID {
		t.Fatalf("same key rotated the slot: %v %q→%q", err, first.CredentialID, again.CredentialID)
	}
	rotated, err := e.SaveProfile(again, "KEY-2")
	if err != nil || rotated.CredentialID == first.CredentialID {
		t.Fatalf("new key did not rotate: %v", err)
	}
	if _, ok := secrets.m[first.CredentialID]; ok {
		t.Fatal("replaced slot was not released")
	}
	if key, _ := e.ProfileKey("a"); key != "KEY-2" {
		t.Fatalf("ProfileKey = %q", key)
	}
}

func TestConnectionChangesInvalidateVerification(t *testing.T) {
	e, _ := registry(t)
	p, err := e.SaveProfile(upstream("a"), "KEY")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a successful connection test.
	if err = e.update(func(t *tx) error {
		v := t.doc.Profiles["a"]
		v.VerifiedAt = now()
		t.putProfile(v)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	p.Name = "renamed"
	p.ModelIDs = []string{"m1", " m1 ", "m2", ""}
	renamed, err := e.SaveProfile(p, "")
	if err != nil || renamed.VerifiedAt == "" {
		t.Fatalf("rename dropped verification: %v", err)
	}
	if strings.Join(renamed.ModelIDs, ",") != "m1,m2" {
		t.Fatalf("model IDs not normalized: %v", renamed.ModelIDs)
	}
	renamed.BaseURL = "https://other.example.com/v1"
	if _, err = e.SaveProfile(renamed, ""); err == nil {
		t.Fatal("address change kept the old key without asking")
	}
	moved, err := e.SaveProfile(renamed, "KEY")
	if err != nil || moved.VerifiedAt != "" {
		t.Fatalf("address change kept verification: %v", err)
	}
}

func TestDraftProfilesCanBeSavedButNotUsed(t *testing.T) {
	e, _ := registry(t)
	draft := Profile{ID: "draft", Name: "配置1", Protocol: "openai"}
	if _, err := e.SaveProfile(draft, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SaveProject(Project{ID: "project", Name: "p", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	_, err := e.Submit(Request{ID: "r", ProfileID: "draft", ProjectID: "project", Kind: "image", Prompt: "cat"})
	if err == nil || !strings.Contains(err.Error(), "上游地址") {
		t.Fatalf("draft profile accepted a job: %v", err)
	}
}

func TestProfileValidationCoversSharedFields(t *testing.T) {
	for name, alter := range map[string]func(*Profile){
		"remote http":        func(p *Profile) { p.BaseURL = "http://relay.example.com/v1" },
		"xai responses":      func(p *Profile) { p.Protocol, p.ImageAPI = "xai", "responses" },
		"unknown image api":  func(p *Profile) { p.ImageAPI = "chat" },
		"unknown transport":  func(p *Profile) { p.ResponsesTransport = "grpc" },
		"unknown policy":     func(p *Profile) { p.RequestPolicy = "loose" },
		"unknown effort":     func(p *Profile) { p.ReasoningEffort = "max" },
		"negative limit":     func(p *Profile) { p.ConcurrencyLimit = -1 },
		"self fallback":      func(p *Profile) { p.FallbackProfileID = p.ID },
		"credential in path": func(p *Profile) { p.BaseURL = "https://user:pass@relay.example.com/v1" },
		"local http unasked": func(p *Profile) { p.BaseURL = "http://api.localhost:8080/v1" },
	} {
		p := upstream("a")
		alter(&p)
		if p.Validate() == nil {
			t.Errorf("%s accepted", name)
		}
	}
	p := upstream("a")
	p.BaseURL, p.AllowInsecure = "http://relay.example.com/v1", true
	if err := p.Validate(); err != nil {
		t.Fatalf("explicitly insecure upstream rejected: %v", err)
	}
	p = upstream("a")
	p.BaseURL, p.AllowLocal = "http://api.localhost:8080/v1", true
	if err := p.Validate(); err != nil {
		t.Fatalf("localhost subdomain rejected: %v", err)
	}
}

// The model catalog caches whatever an upstream lists. A large or odd catalog
// is trimmed, never a reason to refuse saving the profile.
func TestLargeModelCatalogsAreBoundedNotRejected(t *testing.T) {
	p := upstream("a")
	p.ModelIDs = make([]string, maxModelIDs+50)
	fillModels(p.ModelIDs)
	p.ModelIDs[1] = strings.Repeat("x", maxModelIDBytes+1)
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(p.ModelIDs) != maxModelIDs || p.ModelIDs[0] != "model-0" || p.ModelIDs[1] != "model-2" {
		t.Fatalf("catalog = %d entries starting %v", len(p.ModelIDs), p.ModelIDs[:2])
	}
}

func fillModels(ids []string) {
	for i := range ids {
		ids[i] = fmt.Sprint("model-", i)
	}
}

func TestDuplicateCopiesTheKeyIntoItsOwnSlot(t *testing.T) {
	e, secrets := registry(t)
	src, err := e.SaveProfile(upstream("a"), "KEY")
	if err != nil {
		t.Fatal(err)
	}
	cp, err := e.DuplicateProfile("a")
	if err != nil {
		t.Fatal(err)
	}
	if cp.ID == src.ID || cp.CredentialID == src.CredentialID || !cp.HasKey || cp.Name != "上游 a · 副本" {
		t.Fatalf("duplicate = %+v", cp)
	}
	if secrets.m[cp.CredentialID] != "KEY" {
		t.Fatal("duplicate has no copy of the key")
	}
	if err = e.DeleteProfile(cp.ID); err != nil {
		t.Fatal(err)
	}
	if secrets.m[src.CredentialID] != "KEY" {
		t.Fatal("deleting the copy removed the original key")
	}
}

func TestClassicImportIsIdempotentAndNeverResurrects(t *testing.T) {
	e, secrets := registry(t)
	legacy := map[string]string{"classic-a": "KEY-A", "classic-b": "KEY-B"}
	reads := 0
	legacyKey := func(id string) (string, error) {
		reads++
		return legacy[id], nil
	}
	a, b := upstream("classic-a"), upstream("classic-b")
	b.FallbackProfileID = "classic-a"
	c := upstream("classic-c")
	c.FallbackProfileID = "missing"
	broken := upstream("classic-broken")
	broken.BaseURL = "ftp://relay.example.com"
	n, err := e.ImportProfiles([]Profile{a, b, c, broken}, legacyKey)
	if err != nil || n != 4 {
		t.Fatalf("imported %d, %v", n, err)
	}
	list, _ := e.Profiles()
	byID := map[string]Profile{}
	for _, p := range list {
		byID[p.ID] = p
	}
	if !byID["classic-a"].HasKey || secrets.m[byID["classic-a"].CredentialID] != "KEY-A" {
		t.Fatal("legacy key not copied")
	}
	if byID["classic-c"].HasKey || byID["classic-c"].FallbackProfileID != "" || byID["classic-b"].FallbackProfileID != "classic-a" {
		t.Fatalf("fallbacks not resolved: %+v", byID)
	}
	if d := byID["classic-broken"]; d.BaseURL != "" || d.Name != broken.Name || d.ImageModel != broken.ImageModel {
		t.Fatalf("unusable address not kept as a draft: %+v", d)
	}
	reads = 0
	if n, err = e.ImportProfiles([]Profile{a, b, c, broken}, legacyKey); err != nil || n != 0 || reads != 0 {
		t.Fatalf("second import changed things: %d %v reads=%d", n, err, reads)
	}
	if err = e.DeleteProfile("classic-a"); err != nil {
		t.Fatal(err)
	}
	if p, _ := e.Profiles(); len(p) != 3 {
		t.Fatalf("profiles after delete: %d", len(p))
	}
	list, _ = e.Profiles()
	for _, p := range list {
		if p.FallbackProfileID == "classic-a" {
			t.Fatal("fallback still points at a deleted profile")
		}
	}
	if n, err = e.ImportProfiles([]Profile{a}, legacyKey); err != nil || n != 0 {
		t.Fatalf("deleted profile resurrected: %d %v", n, err)
	}
}

// The classic list is replaced by the registry's after the import, so nothing
// the classic editor kept may be dropped for failing the registry's rules.
func TestClassicImportKeepsWhatTheRegistryWouldRefuse(t *testing.T) {
	e, _ := registry(t)
	big := upstream("big-catalog")
	big.ModelIDs = make([]string, maxModelIDs+1)
	fillModels(big.ModelIDs)
	local := upstream("local-subdomain")
	local.BaseURL, local.AllowLocal = "http://api.localhost:3000/v1", true
	odd := upstream("odd")
	odd.FallbackProfileID, odd.ImageModel, odd.RequestPolicy = "odd", strings.Repeat("m", 300), "loose"
	unnamed := upstream("unnamed")
	unnamed.Name, unnamed.BaseURL = "  ", "http://192.168.1.5:8080/v1"
	n, err := e.ImportProfiles([]Profile{big, local, odd, unnamed, {ID: "bad id!", Name: "x", Protocol: "openai"}}, nil)
	if err != nil || n != 4 {
		t.Fatalf("imported %d, %v", n, err)
	}
	list, _ := e.Profiles()
	byID := map[string]Profile{}
	for _, p := range list {
		byID[p.ID] = p
	}
	if len(byID["big-catalog"].ModelIDs) != maxModelIDs || byID["big-catalog"].BaseURL == "" {
		t.Fatalf("large catalog = %d models at %q", len(byID["big-catalog"].ModelIDs), byID["big-catalog"].BaseURL)
	}
	if byID["local-subdomain"].BaseURL != local.BaseURL {
		t.Fatalf("localhost subdomain lost its address: %+v", byID["local-subdomain"])
	}
	if d := byID["odd"]; d.FallbackProfileID != "" || d.ImageModel != "" || d.RequestPolicy != "" || d.Name != odd.Name {
		t.Fatalf("odd profile = %+v", d)
	}
	if d := byID["unnamed"]; d.Name != "未命名上游" || d.BaseURL != "" {
		t.Fatalf("unnamed profile = %+v", d)
	}
}

func TestStudioOnlyKeysAreNotHandedOut(t *testing.T) {
	e, _ := registry(t)
	p := upstream("video")
	p.Protocol = "xai"
	if _, err := e.SaveProfile(p, "XAI-KEY"); err != nil {
		t.Fatal(err)
	}
	if key, err := e.ProfileKey("video"); err == nil || key != "" {
		t.Fatalf("xAI key handed out: %q, %v", key, err)
	}
}

func TestFallbackMustExist(t *testing.T) {
	e, _ := registry(t)
	p := upstream("a")
	p.FallbackProfileID = "nowhere"
	if _, err := e.SaveProfile(p, ""); err == nil {
		t.Fatal("dangling fallback accepted")
	}
}

func TestJobsDoNotPinTheModelCatalog(t *testing.T) {
	e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		return Output{Data: pixel()}, nil
	}))
	p, err := e.Profiles()
	if err != nil || len(p) != 1 {
		t.Fatal(err)
	}
	withCatalog := p[0]
	withCatalog.ModelIDs = []string{"catalog-model-a", "catalog-model-b"}
	withCatalog.ConcurrencyLimit = 3
	if _, err = e.SaveProfile(withCatalog, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Submit(req("pinned")); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, "pinned", "succeeded")
	if j.Profile.ModelIDs != nil || j.Profile.ConcurrencyLimit != 0 {
		t.Fatalf("job pinned editor metadata: %+v", j.Profile)
	}
	data, _ := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if strings.Count(string(data), "catalog-model-a") != 1 {
		t.Fatal("model catalog copied into job history")
	}
}

func TestProfilesListInCreationOrder(t *testing.T) {
	e, _ := registry(t)
	for _, id := range []string{"z", "a", "m"} {
		if _, err := e.SaveProfile(upstream(id), ""); err != nil {
			t.Fatal(err)
		}
		time.Sleep(20 * time.Millisecond) // coarse clocks must still order creation
	}
	list, _ := e.Profiles()
	got := []string{}
	for _, p := range list {
		got = append(got, p.ID)
	}
	if strings.Join(got, "") != "zam" {
		t.Fatalf("order = %v", got)
	}
	if key, err := e.ProfileKey("z"); err != nil || key != "" {
		t.Fatalf("keyless ProfileKey = %q, %v", key, err)
	}
	if _, err := e.ProfileKey("unknown"); err == nil {
		t.Fatal("unknown profile key read")
	}
}

var errLegacy = errors.New("legacy store unavailable")

func TestImportSurvivesAnUnreadableLegacyKey(t *testing.T) {
	e, _ := registry(t)
	n, err := e.ImportProfiles([]Profile{upstream("a")}, func(string) (string, error) { return "", errLegacy })
	if err != nil || n != 1 {
		t.Fatalf("import = %d, %v", n, err)
	}
	list, _ := e.Profiles()
	if list[0].HasKey {
		t.Fatal("profile claims a key it does not have")
	}
}

func TestClearingAKeyKeepsItForRunningJobs(t *testing.T) {
	e, secrets := registry(t)
	p, err := e.SaveProfile(upstream("a"), "KEY")
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := e.ClearProfileKey("a")
	if err != nil || cleared.HasKey || cleared.CredentialID != "" {
		t.Fatalf("cleared = %+v, %v", cleared, err)
	}
	if _, ok := secrets.m[p.CredentialID]; ok {
		t.Fatal("unused key was not removed")
	}
	if key, _ := e.ProfileKey("a"); key != "" {
		t.Fatal("cleared key still readable")
	}
}
