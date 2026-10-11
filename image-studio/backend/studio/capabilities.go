package studio

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"slices"
	"strings"

	"github.com/yuanhua/image-gptcodex/pkg/client"
	_ "golang.org/x/image/webp"
)

// Optional booleans are intentional: absent means unknown, never supported.
// These are local observations supplied by the user, not a gateway extension.
type ImageProviderCapabilities struct {
	SchemaVersion int                                  `json:"schemaVersion"`
	PreferredAPI  string                               `json:"preferredApi,omitempty"`
	Images        *ImagesCapabilities                  `json:"images,omitempty"`
	Responses     *ResponsesCapabilities               `json:"responses,omitempty"`
	PromptModes   []string                             `json:"promptModes,omitempty"`
	ModelRules    map[string]ModelProtocolCapabilities `json:"modelRules,omitempty"`
}

type ImagesCapabilities struct {
	Generate *bool `json:"generate,omitempty"`
	Edit     *bool `json:"edit,omitempty"`
	Stream   *bool `json:"stream,omitempty"`
}

type ResponsesCapabilities struct {
	ImageTool *bool `json:"imageTool,omitempty"`
	SSE       *bool `json:"sse,omitempty"`
	WebSocket *bool `json:"websocket,omitempty"`
}

type ModelProtocolCapabilities struct {
	Images    *ImageModelCapabilities `json:"images,omitempty"`
	Responses *ImageModelCapabilities `json:"responses,omitempty"`
}

type ImageModelCapabilities = client.ImageModelCapabilities

func (p Profile) capabilityScope() [10]string {
	api := p.ImageAPI
	if api == "" {
		api = defaultImageAPI
	}
	return [10]string{p.BaseURL, p.Protocol, p.ImageModel, p.TextModel, api, p.ProviderPreset,
		p.ResponsesTransport, fmt.Sprint(p.AllowLocal), fmt.Sprint(p.AllowInsecure), p.RequestPolicy}
}

func (p *Profile) validateCapabilities() error {
	p.ProviderPreset = strings.TrimSpace(p.ProviderPreset)
	switch p.ProviderPreset {
	case "", "custom":
	case "sub2api":
		if p.Protocol != "openai" {
			return errors.New("sub2api 预设需要 OpenAI 兼容协议")
		}
	default:
		return errors.New("未知上游预设")
	}
	if p.Capabilities == nil {
		return nil
	}
	p.Capabilities = cloneCapabilities(p.Capabilities)
	c := p.Capabilities
	if c.SchemaVersion != 1 {
		return errors.New("不支持的上游能力配置版本")
	}
	if c.PreferredAPI != "" && c.PreferredAPI != defaultImageAPI && c.PreferredAPI != responsesImageAPI {
		return errors.New("能力配置中的首选图像接口无效")
	}
	if len(c.PromptModes) > 2 {
		return errors.New("提示词模式能力配置无效")
	}
	for _, mode := range c.PromptModes {
		if mode != "verbatim" && mode != "assisted" {
			return errors.New("提示词模式能力配置无效")
		}
	}
	if len(c.ModelRules) > 128 {
		return errors.New("能力配置最多包含 128 个精确模型 ID")
	}
	for model, protocols := range c.ModelRules {
		if model == "" || model != strings.TrimSpace(model) || len(model) > 200 {
			return errors.New("能力配置需要有效的精确模型 ID")
		}
		for _, rule := range []*ImageModelCapabilities{protocols.Images, protocols.Responses} {
			if rule == nil {
				continue
			}
			if rule.MaxInputImages != nil && (*rule.MaxInputImages < 0 || *rule.MaxInputImages > 16) {
				return errors.New("参考图能力上限必须为 0–16")
			}
			for _, values := range [][]string{rule.Qualities, rule.Sizes, rule.Formats, rule.InputFidelityValues} {
				if len(values) > 64 {
					return errors.New("能力参数列表过长")
				}
				for _, value := range values {
					if value == "" || value != strings.TrimSpace(value) || len(value) > 64 {
						return errors.New("能力参数必须是有效的精确值")
					}
				}
			}
		}
	}
	return nil
}

func clonePointer[T any](p *T) *T {
	if p == nil {
		return nil
	}
	copy := *p
	return &copy
}

func cloneModelCapabilities(rule *ImageModelCapabilities) *ImageModelCapabilities {
	if rule == nil {
		return nil
	}
	copy := *rule
	copy.Qualities, copy.Sizes = slices.Clone(rule.Qualities), slices.Clone(rule.Sizes)
	copy.Formats, copy.InputFidelityValues = slices.Clone(rule.Formats), slices.Clone(rule.InputFidelityValues)
	copy.MaxInputImages = clonePointer(rule.MaxInputImages)
	copy.SupportsMask, copy.SupportsInputFidelity = clonePointer(rule.SupportsMask), clonePointer(rule.SupportsInputFidelity)
	return &copy
}

func cloneCapabilities(c *ImageProviderCapabilities) *ImageProviderCapabilities {
	if c == nil {
		return nil
	}
	copy := *c
	copy.PromptModes = slices.Clone(c.PromptModes)
	if c.Images != nil {
		copy.Images = &ImagesCapabilities{clonePointer(c.Images.Generate), clonePointer(c.Images.Edit), clonePointer(c.Images.Stream)}
	}
	if c.Responses != nil {
		copy.Responses = &ResponsesCapabilities{clonePointer(c.Responses.ImageTool), clonePointer(c.Responses.SSE), clonePointer(c.Responses.WebSocket)}
	}
	if c.ModelRules != nil {
		copy.ModelRules = make(map[string]ModelProtocolCapabilities, len(c.ModelRules))
		for id, rule := range c.ModelRules {
			copy.ModelRules[id] = ModelProtocolCapabilities{cloneModelCapabilities(rule.Images), cloneModelCapabilities(rule.Responses)}
		}
	}
	return &copy
}

// Resolve only the exact model and selected protocol. A configured provider
// without a matching rule stays unknown, including optional input_fidelity.
func profileClientModelCapabilities(p Profile) *client.ImageModelCapabilities {
	if p.Capabilities == nil {
		if p.ProviderPreset == "sub2api" {
			return &client.ImageModelCapabilities{}
		}
		return nil
	}
	rules := p.Capabilities.ModelRules[p.ImageModel]
	rule := rules.Images
	if p.ImageAPI == responsesImageAPI {
		rule = rules.Responses
	}
	if rule == nil {
		return &client.ImageModelCapabilities{}
	}
	return cloneModelCapabilities(rule)
}

func explicitlyUnsupported(supported *bool) bool { return supported != nil && !*supported }

func imageStreamingDisabled(p Profile) bool {
	return p.Capabilities != nil && p.Capabilities.Images != nil && explicitlyUnsupported(p.Capabilities.Images.Stream)
}

// Check before queueing, then again when a workflow has resolved its inputs.
// Unknown allows a deliberate validation request, but is never advertised as
// tested support. Known restrictions fail before any billable network request.
func validateImageCapabilities(p Profile, r Request) error {
	if r.Kind != "image" || p.Protocol != "openai" {
		return nil
	}
	count := len(r.ReferenceAssetIDs)
	if r.ReferenceAssetID != "" {
		count++
	}
	c := p.Capabilities
	if c != nil {
		mode := r.Parameters.PromptMode
		if mode == "" {
			mode = "verbatim"
		}
		if len(c.PromptModes) > 0 && !slices.Contains(c.PromptModes, mode) {
			return fmt.Errorf("当前上游能力配置未开放提示词模式 %q", mode)
		}
		if p.ImageAPI == responsesImageAPI {
			if c.Responses != nil {
				if explicitlyUnsupported(c.Responses.ImageTool) {
					return errors.New("当前上游已确认不支持 Responses 图片工具，请选择 Images API 或重新核对权限")
				}
				if p.ResponsesTransport == "websocket" && explicitlyUnsupported(c.Responses.WebSocket) {
					return errors.New("当前上游已确认不支持 Responses WebSocket，请选择 HTTP SSE")
				}
				if p.ResponsesTransport != "websocket" && explicitlyUnsupported(c.Responses.SSE) {
					return errors.New("当前上游已确认不支持 Responses SSE，请核对所选接口与传输方式")
				}
			}
		} else if c.Images != nil {
			if count > 0 && explicitlyUnsupported(c.Images.Edit) {
				return errors.New("当前上游已确认不支持 Images 参考图编辑")
			}
			if count == 0 && explicitlyUnsupported(c.Images.Generate) {
				return errors.New("当前上游已确认不支持 Images 文生图")
			}
		}
	}
	rule := profileClientModelCapabilities(p)
	if rule == nil {
		return nil
	}
	if rule.MaxInputImages != nil && count > *rule.MaxInputImages {
		return fmt.Errorf("当前模型与接口最多支持 %d 张参考图", *rule.MaxInputImages)
	}
	if r.MaskAssetID != "" && explicitlyUnsupported(rule.SupportsMask) {
		return errors.New("当前模型与接口已确认不支持蒙版编辑")
	}
	quality := r.Image.Quality
	if quality == "" {
		quality = r.Parameters.Quality
	}
	format := r.Image.OutputFormat
	if format == "" {
		format = r.Parameters.OutputFormat
	}
	for _, field := range []struct {
		label, value, fallback string
		values                 []string
	}{
		{"质量", quality, client.DefaultQuality, rule.Qualities},
		{"尺寸", r.Parameters.Size, client.DefaultSize, rule.Sizes},
		{"输出格式", format, "png", rule.Formats},
	} {
		value := field.value
		if value == "" {
			value = field.fallback
		}
		if len(field.values) > 0 && !slices.Contains(field.values, value) {
			return fmt.Errorf("当前模型与接口不支持%s %q；允许值：%s", field.label, value, strings.Join(field.values, ", "))
		}
	}
	fidelity := r.Image.InputFidelity
	if fidelity == "" {
		fidelity = r.Parameters.InputFidelity
	}
	if count > 0 && rule.SupportsInputFidelity != nil && *rule.SupportsInputFidelity && fidelity != "" && fidelity != "auto" && len(rule.InputFidelityValues) > 0 && !slices.Contains(rule.InputFidelityValues, fidelity) {
		return fmt.Errorf("当前模型与接口不支持 input_fidelity=%s", fidelity)
	}
	return nil
}

// Masks must be valid PNGs with transparency, sized to the first reference.
// Dimension checks happen before decoding pixels to bound memory use.
func validateImageMask(reference, mask *Output) error {
	if reference == nil || mask == nil {
		return errors.New("蒙版编辑需要首张参考图和 PNG 蒙版")
	}
	refConfig, _, err := image.DecodeConfig(bytes.NewReader(reference.Data))
	if err != nil {
		return errors.New("首张参考图无法解码，不能验证蒙版尺寸")
	}
	maskConfig, err := png.DecodeConfig(bytes.NewReader(mask.Data))
	if err != nil {
		return errors.New("蒙版必须是有效的 PNG 图片")
	}
	if maskConfig.Width != refConfig.Width || maskConfig.Height != refConfig.Height {
		return errors.New("蒙版尺寸必须与首张参考图完全一致")
	}
	if maskConfig.Width <= 0 || maskConfig.Height <= 0 || int64(maskConfig.Width)*int64(maskConfig.Height) > 64*1024*1024 {
		return errors.New("蒙版像素数量超出安全解码范围")
	}
	decoded, err := png.Decode(bytes.NewReader(mask.Data))
	if err != nil {
		return errors.New("PNG 蒙版损坏，无法解码")
	}
	for y := 0; y < maskConfig.Height; y++ {
		for x := 0; x < maskConfig.Width; x++ {
			_, _, _, alpha := decoded.At(x, y).RGBA()
			if alpha < 0xffff {
				return nil
			}
		}
	}
	return errors.New("蒙版必须包含透明区域，用于标记需要编辑的部分")
}
