package historymedia

import (
	"os"
	"path/filepath"
	"strings"

	"image-studio/gio-client/internal/kernel"
	shared "image-studio/shared/compat"
)

type Report struct {
	StatePath                     string `json:"state_path"`
	Client                        string `json:"client,omitempty"`
	UpdatedAt                     int64  `json:"updated_at"`
	HistoryCount                  int    `json:"history_count"`
	SavedPathPresent              int    `json:"saved_path_present"`
	SavedFilePresent              int    `json:"saved_file_present"`
	SavedFileMissing              int    `json:"saved_file_missing"`
	ThumbPathPresent              int    `json:"thumb_path_present"`
	ThumbFilePresent              int    `json:"thumb_file_present"`
	ThumbFileMissing              int    `json:"thumb_file_missing"`
	PreviewPathPresent            int    `json:"preview_path_present"`
	PreviewFilePresent            int    `json:"preview_file_present"`
	PreviewFileMissing            int    `json:"preview_file_missing"`
	PreviewOnlyBackfillCandidates int    `json:"preview_only_backfill_candidates"`
	HeavyBackfillCandidates       int    `json:"heavy_backfill_candidates"`
}

type BackfillUpdate struct {
	PreviewPath string `json:"preview_path,omitempty"`
	ThumbPath   string `json:"thumb_path,omitempty"`
}

type BackfillSummary struct {
	PreviewOnlyRequested bool `json:"preview_only_requested"`
	Limit                int  `json:"limit"`
	CandidatePaths       int  `json:"candidate_paths"`
	PreviewOnlyPaths     int  `json:"preview_only_paths"`
	HeavyPaths           int  `json:"heavy_paths"`
	FailedPaths          int  `json:"failed_paths"`
	UpdatedItems         int  `json:"updated_items"`
	PreviewPathsAdded    int  `json:"preview_paths_added"`
	ThumbPathsAdded      int  `json:"thumb_paths_added"`
}

type pathGroup struct {
	SavedPath        string
	Items            []shared.HistoryItem
	NeedPreview      bool
	NeedThumb        bool
	FallbackThumb    string
	PreviewOnlyGroup bool
}

func BuildReport(state shared.State, statePath string) Report {
	report := Report{
		StatePath:    filepath.Clean(strings.TrimSpace(statePath)),
		Client:       strings.TrimSpace(state.Client),
		UpdatedAt:    state.UpdatedAt,
		HistoryCount: len(state.History),
	}
	groups := buildPathGroups(state.History)
	for _, item := range state.History {
		savedPath := strings.TrimSpace(item.SavedPath)
		thumbPath := strings.TrimSpace(item.ThumbPath)
		previewPath := strings.TrimSpace(item.PreviewPath)
		if savedPath != "" {
			report.SavedPathPresent++
			if pathReady(savedPath) {
				report.SavedFilePresent++
			} else {
				report.SavedFileMissing++
			}
		}
		if thumbPath != "" {
			report.ThumbPathPresent++
			if pathReady(thumbPath) {
				report.ThumbFilePresent++
			} else {
				report.ThumbFileMissing++
			}
		}
		if previewPath != "" {
			report.PreviewPathPresent++
			if pathReady(previewPath) {
				report.PreviewFilePresent++
			} else {
				report.PreviewFileMissing++
			}
		}
	}
	for _, group := range groups {
		if group.PreviewOnlyGroup {
			report.PreviewOnlyBackfillCandidates++
		} else if group.NeedPreview || group.NeedThumb {
			report.HeavyBackfillCandidates++
		}
	}
	return report
}

func BuildBackfillUpdates(items []shared.HistoryItem, limit int, previewOnly bool) (map[string]BackfillUpdate, BackfillSummary) {
	groups := buildPathGroups(items)
	ordered := selectPathGroups(groups, limit, previewOnly)
	summary := BackfillSummary{
		PreviewOnlyRequested: previewOnly,
		Limit:                limit,
		CandidatePaths:       len(ordered),
	}
	updates := make(map[string]BackfillUpdate, len(items))
	for _, group := range ordered {
		if group.PreviewOnlyGroup {
			summary.PreviewOnlyPaths++
		} else {
			summary.HeavyPaths++
		}
		update := BackfillUpdate{}
		if group.NeedPreview && !group.NeedThumb && group.FallbackThumb != "" {
			previewPath, err := kernel.EnsurePreviewForPathWithFallback(group.SavedPath, group.FallbackThumb)
			if err == nil && strings.TrimSpace(previewPath) != "" {
				update.PreviewPath = previewPath
			}
		}
		if (group.NeedPreview && strings.TrimSpace(update.PreviewPath) == "") || group.NeedThumb {
			previewPath, thumbPath, err := kernel.EnsurePreviewAndThumbForPath(group.SavedPath)
			if err != nil && strings.TrimSpace(previewPath) == "" && strings.TrimSpace(thumbPath) == "" {
				summary.FailedPaths++
				continue
			}
			if group.NeedPreview && strings.TrimSpace(update.PreviewPath) == "" {
				update.PreviewPath = previewPath
			}
			if group.NeedThumb {
				update.ThumbPath = thumbPath
			}
		}
		if strings.TrimSpace(update.PreviewPath) == "" && strings.TrimSpace(update.ThumbPath) == "" {
			summary.FailedPaths++
			continue
		}
		for _, item := range group.Items {
			itemUpdate := BackfillUpdate{}
			if group.NeedPreview && !pathReady(item.PreviewPath) && strings.TrimSpace(update.PreviewPath) != "" {
				itemUpdate.PreviewPath = update.PreviewPath
			}
			if group.NeedThumb && !pathReady(item.ThumbPath) && strings.TrimSpace(update.ThumbPath) != "" {
				itemUpdate.ThumbPath = update.ThumbPath
			}
			if strings.TrimSpace(itemUpdate.PreviewPath) == "" && strings.TrimSpace(itemUpdate.ThumbPath) == "" {
				continue
			}
			updates[item.ID] = itemUpdate
			summary.UpdatedItems++
			if itemUpdate.PreviewPath != "" {
				summary.PreviewPathsAdded++
			}
			if itemUpdate.ThumbPath != "" {
				summary.ThumbPathsAdded++
			}
		}
	}
	return updates, summary
}

func ApplyBackfillUpdates(state *shared.State, updates map[string]BackfillUpdate) int {
	if state == nil || len(updates) == 0 {
		return 0
	}
	changed := 0
	for i := range state.History {
		update, ok := updates[state.History[i].ID]
		if !ok {
			continue
		}
		itemChanged := false
		if strings.TrimSpace(update.PreviewPath) != "" && !pathReady(state.History[i].PreviewPath) {
			state.History[i].PreviewPath = update.PreviewPath
			itemChanged = true
		}
		if strings.TrimSpace(update.ThumbPath) != "" && !pathReady(state.History[i].ThumbPath) {
			state.History[i].ThumbPath = update.ThumbPath
			itemChanged = true
		}
		if itemChanged {
			changed++
		}
	}
	return changed
}

func selectPathGroups(groups []*pathGroup, limit int, previewOnly bool) []*pathGroup {
	previewOnlyGroups := make([]*pathGroup, 0, len(groups))
	heavyGroups := make([]*pathGroup, 0, len(groups))
	for _, group := range groups {
		if group.PreviewOnlyGroup {
			previewOnlyGroups = append(previewOnlyGroups, group)
			continue
		}
		if group.NeedPreview || group.NeedThumb {
			heavyGroups = append(heavyGroups, group)
		}
	}
	if previewOnly {
		return capGroups(previewOnlyGroups, limit)
	}
	selected := append([]*pathGroup(nil), previewOnlyGroups...)
	selected = append(selected, heavyGroups...)
	return capGroups(selected, limit)
}

func capGroups(groups []*pathGroup, limit int) []*pathGroup {
	if limit <= 0 || len(groups) <= limit {
		return groups
	}
	return groups[:limit]
}

func buildPathGroups(items []shared.HistoryItem) []*pathGroup {
	groups := make([]*pathGroup, 0, len(items))
	bySavedPath := make(map[string]*pathGroup, len(items))
	for _, item := range items {
		savedPath := strings.TrimSpace(item.SavedPath)
		if strings.TrimSpace(item.ID) == "" || savedPath == "" || !pathReady(savedPath) {
			continue
		}
		group := bySavedPath[savedPath]
		if group == nil {
			group = &pathGroup{SavedPath: savedPath}
			bySavedPath[savedPath] = group
			groups = append(groups, group)
		}
		group.Items = append(group.Items, item)
		previewReady := pathReady(item.PreviewPath)
		thumbReady := pathReady(item.ThumbPath)
		if !previewReady {
			group.NeedPreview = true
			if thumbReady && group.FallbackThumb == "" {
				group.FallbackThumb = strings.TrimSpace(item.ThumbPath)
			}
		}
		if !thumbReady {
			group.NeedThumb = true
		}
	}
	for _, group := range groups {
		group.PreviewOnlyGroup = group.NeedPreview && !group.NeedThumb && group.FallbackThumb != ""
	}
	return groups
}

func pathReady(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
