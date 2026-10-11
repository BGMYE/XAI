package studio

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func assertProjectArrayJSON(t *testing.T, p Project) {
	t.Helper()
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"nodes", "edges"} {
		if len(fields[key]) == 0 || fields[key][0] != '[' {
			t.Fatalf("%s must be an array: %s", key, data)
		}
	}
}

func TestProjectCollectionsClassicSubmissionAndHistoryImport(t *testing.T) {
	for _, mode := range []string{"submit", "history"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
				return Output{Data: pixel()}, nil
			}))
			before, _ := e.Snapshot()
			r := req("legacy-collections")
			r.ProjectID, r.Source = "classic", "classic"
			if mode == "submit" {
				if _, err := e.Submit(r); err != nil {
					t.Fatal(err)
				}
				await(t, e, r.ID, "succeeded")
			} else {
				source := filepath.Join(t.TempDir(), "history.png")
				if err := os.WriteFile(source, pixel(), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := e.ImportHistory(source, r, now(), "generate", ""); err != nil {
					t.Fatal(err)
				}
			}
			snapshot, err := e.Snapshot()
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, project := range snapshot.Projects {
				assertProjectArrayJSON(t, project)
				if project.ID == "classic" {
					found = true
				}
			}
			if !found {
				t.Fatal("missing migrated project")
			}
			changes, err := e.Changes(before.Epoch, before.Revision)
			if err != nil {
				t.Fatal(err)
			}
			for _, project := range changes.Projects {
				assertProjectArrayJSON(t, project)
			}
			d, err := e.repo.read()
			if err != nil {
				t.Fatal(err)
			}
			assertProjectArrayJSON(t, d.Projects["classic"])
		})
	}
}

func TestProjectCollectionsExistingNullDatabaseRecoversOnRead(t *testing.T) {
	root := t.TempDir()
	d := emptyDocument()
	d.Projects["legacy"] = Project{ID: "legacy", Name: "Old project", Viewport: Viewport{Zoom: 1}, Revision: 1}
	repo := repository{root: root}
	if err := repo.write(d); err != nil {
		t.Fatal(err)
	}
	e, err := Open(root, &memorySecrets{m: map[string]string{}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	snapshot, err := e.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Projects) != 1 {
		t.Fatal("old project lost")
	}
	p := snapshot.Projects[0]
	assertProjectArrayJSON(t, p)
	p.Name = "Still editable"
	if _, err := e.SaveProject(p); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "studio.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved document
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Projects["legacy"].Nodes == nil || saved.Projects["legacy"].Edges == nil {
		t.Fatal("null collections persisted again")
	}
}
