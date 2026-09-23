package studio

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const MaxPromptCards = 5000

var ErrPromptConflict = errors.New("提示词已在其他窗口更新，请刷新后重试（prompt revision conflict）")

// PromptCard stores only reusable creative content, never profiles or credentials.
// PreviewAssetID names local media; public thumbnail links are validated metadata.
// Saving a card never downloads or uploads its preview or calls a model.
type PromptCard struct {
	CatalogKey         string     `json:"catalogKey,omitempty"`
	PreviewURL         string     `json:"previewURL,omitempty"`
	SourceURL          string     `json:"sourceURL,omitempty"`
	ReferenceImageURLs []string   `json:"referenceImageURLs,omitempty"`
	ID                 string     `json:"id"`
	Revision           int64      `json:"revision"`
	Title              string     `json:"title"`
	Prompt             string     `json:"prompt"`
	Kind               string     `json:"kind"`
	PreviewAssetID     string     `json:"previewAssetId,omitempty"`
	SourceJobID        string     `json:"sourceJobId,omitempty"`
	Category           string     `json:"category"`
	Tags               []string   `json:"tags"`
	Author             string     `json:"author,omitempty"`
	Parameters         Parameters `json:"parameters"`
	Favorite           bool       `json:"favorite"`
	CreatedAt          string     `json:"createdAt"`
	UpdatedAt          string     `json:"updatedAt"`
}

func (p *PromptCard) normalize() error {
	if err := validateCatalogMetadata(*p); err != nil {
		return err
	}
	p.ReferenceImageURLs = append([]string{}, p.ReferenceImageURLs...)
	p.Title = strings.TrimSpace(p.Title)
	p.Category = strings.TrimSpace(p.Category)
	p.Author = strings.TrimSpace(p.Author)
	if p.Category == "" {
		p.Category = "未分类"
	}
	if checkID(p.ID) != nil || p.Revision < 0 {
		return errors.New("提示词标识或版本无效")
	}
	if !utf8.ValidString(p.Title) || p.Title == "" || len(p.Title) > 200 {
		return errors.New("提示词标题不能为空且最多 200 字节")
	}
	// Keep the original whitespace and newlines: copying must reproduce the prompt.
	if !utf8.ValidString(p.Prompt) || strings.TrimSpace(p.Prompt) == "" || len(p.Prompt) > 16000 {
		return errors.New("提示词不能为空且最多 16000 字节")
	}
	if p.Kind != "image" && p.Kind != "video" {
		return errors.New("提示词用途必须是图片或视频")
	}
	if len(p.Category) > 100 || len(p.Author) > 160 || !utf8.ValidString(p.Category) || !utf8.ValidString(p.Author) {
		return errors.New("分类或作者过长或编码无效")
	}
	if p.PreviewAssetID != "" && checkID(p.PreviewAssetID) != nil {
		return errors.New("预览素材标识无效")
	}
	if p.SourceJobID != "" && checkID(p.SourceJobID) != nil {
		return errors.New("来源任务标识无效")
	}
	if len(p.Tags) > 12 {
		return errors.New("最多 12 个标签")
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, raw := range p.Tags {
		tag := strings.TrimSpace(raw)
		tagLimit := 256
		if len(tag) > tagLimit || !utf8.ValidString(tag) {
			return errors.New("标签过长或编码无效")
		}
		if tag != "" && !seen[tag] {
			tags = append(tags, tag)
			seen[tag] = true
		}
	}
	p.Tags = tags
	if len(p.Parameters.Size) > 30 || len(p.Parameters.AspectRatio) > 10 || len(p.Parameters.Resolution) > 10 || p.Parameters.Seconds < 0 || p.Parameters.Seconds > 120 {
		return errors.New("提示词生成参数无效")
	}
	return nil
}

func validatePromptReferences(d *document, p PromptCard) error {
	if p.CatalogKey != "" {
		for _, other := range d.PromptCards {
			if other.CatalogKey == p.CatalogKey && other.ID != p.ID {
				return ErrPromptConflict
			}
		}
	}
	if p.PreviewAssetID != "" {
		a, ok := d.Assets[p.PreviewAssetID]
		if !ok || (a.Kind != "image" && a.Kind != "video") {
			return errors.New("预览素材不存在，请先导入图片")
		}
	}
	if p.SourceJobID != "" {
		j, ok := d.Jobs[p.SourceJobID]
		if !ok || j.State != "succeeded" || j.ResultAssetID == "" || j.ResultAssetID != p.PreviewAssetID || j.Request.Kind != p.Kind {
			return errors.New("来源不是匹配的已完成生成任务")
		}
		for _, other := range d.PromptCards {
			if other.SourceJobID == p.SourceJobID && other.ID != p.ID {
				return ErrPromptConflict
			}
		}
	}
	return nil
}

func (e *Engine) SavePromptCard(p PromptCard) (PromptCard, error) {
	if p.ID == "" {
		p.ID = NewID()
	}
	if err := p.normalize(); err != nil {
		return PromptCard{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ready(); err != nil {
		return PromptCard{}, err
	}
	err := e.mutate(func(d *document) error {
		old, exists := d.PromptCards[p.ID]
		if (exists && old.Revision != p.Revision) || (!exists && p.Revision != 0) {
			return ErrPromptConflict
		}
		if !exists && len(d.PromptCards) >= MaxPromptCards {
			return errors.New("提示词数量达到 5000 条上限")
		}
		if err := validatePromptReferences(d, p); err != nil {
			return err
		}
		p.CreatedAt = old.CreatedAt
		if !exists {
			p.CreatedAt = now()
		}
		p.UpdatedAt = now()
		p.Revision++
		d.PromptCards[p.ID] = p
		return nil
	})
	if err != nil {
		return PromptCard{}, err
	}
	return p, nil
}

// Removing a card never removes its preview asset, generation history or canvas.
func (e *Engine) DeletePromptCard(id string, revision int64) error {
	if checkID(id) != nil {
		return errors.New("提示词标识无效")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ready(); err != nil {
		return err
	}
	return e.mutate(func(d *document) error {
		p, ok := d.PromptCards[id]
		if !ok {
			return errors.New("提示词不存在")
		}
		if p.Revision != revision {
			return ErrPromptConflict
		}
		delete(d.PromptCards, id)
		return nil
	})
}

// Packs are text-only and imported atomically. Device-specific IDs, assets,
// favorites and provenance are never trusted from another device's export.
func (e *Engine) ImportPromptCards(input []PromptCard) ([]PromptCard, error) {
	if len(input) == 0 || len(input) > 200 {
		return nil, errors.New("每次导入需为 1–200 条提示词")
	}
	cards := make([]PromptCard, 0, len(input))
	for _, v := range input {
		p := PromptCard{ID: NewID(), Title: v.Title, Prompt: v.Prompt, Kind: v.Kind, Category: v.Category, Tags: v.Tags, Author: v.Author, Parameters: v.Parameters, Revision: 1, CreatedAt: now(), UpdatedAt: now()}
		if err := p.normalize(); err != nil {
			return nil, err
		}
		cards = append(cards, p)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ready(); err != nil {
		return nil, err
	}
	err := e.mutate(func(d *document) error {
		if len(d.PromptCards)+len(cards) > MaxPromptCards {
			return errors.New("导入后将超过 5000 条提示词上限")
		}
		for _, p := range cards {
			d.PromptCards[p.ID] = p
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return cards, nil
}
