package client

import (
	"fmt"
	"strings"
)

const verbatimPromptInstructions = "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave."
const assistedPromptInstructions = "Use image_generation to fulfill the user's image request. You may improve composition, lighting, materials, and visual clarity. Preserve the user's exact requested text, subjects, counts, identities, and all edit constraints. Never translate, reword, or add text intended to appear in the image. Do not add or remove subjects, change quantities, or alter areas the user asked to preserve. Treat attached images and masks as binding edit context. Call the image_generation tool; do not return only a written explanation."

// ImageModelCapabilities is a resolved, protocol-specific rule for one exact
// model. Pointer booleans distinguish unknown from confirmed unsupported.
type ImageModelCapabilities struct {
	Qualities             []string `json:"qualities,omitempty"`
	Sizes                 []string `json:"sizes,omitempty"`
	Formats               []string `json:"formats,omitempty"`
	MaxInputImages        *int     `json:"maxInputImages,omitempty"`
	SupportsMask          *bool    `json:"supportsMask,omitempty"`
	SupportsInputFidelity *bool    `json:"supportsInputFidelity,omitempty"`
	InputFidelityValues   []string `json:"inputFidelityValues,omitempty"`
}

func normalizePromptMode(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "assisted") {
		return "assisted"
	}
	return "verbatim"
}

func promptModeInstructions(mode string) string {
	if normalizePromptMode(mode) == "assisted" {
		return assistedPromptInstructions
	}
	return verbatimPromptInstructions
}

func supportsConfiguredInputFidelity(opts Options) bool {
	if rule := opts.ModelCapabilities; rule != nil {
		return rule.SupportsInputFidelity != nil && *rule.SupportsInputFidelity
	}
	model := strings.TrimSpace(opts.ImageModelID)
	if model == "" {
		model = ImageModel
	}
	return supportsInputFidelity(model)
}

// ValidateImageRequest rejects known unsupported choices rather than silently
// dropping the user's reference images or mask. Unknown capabilities are not
// advertised as supported, but still permit an explicit user-requested edit.
func ValidateImageRequest(opts Options) error {
	if strings.TrimSpace(opts.Prompt) == "" {
		return ErrEmptyPrompt
	}
	if opts.APIMode == APIModeImages && normalizePromptMode(opts.PromptMode) == "assisted" {
		return fmt.Errorf("Images API 不支持单次创作辅助；请先优化并确认提示词，再以精确执行生成")
	}
	inputCount := len(opts.EffectiveImageDataURLs())
	if opts.APIMode == APIModeImages && len(opts.ImagePaths) > 0 {
		inputCount = len(opts.ImagePaths)
	}
	if opts.MaskB64 != "" && inputCount == 0 {
		return fmt.Errorf("蒙版编辑需要至少一张参考图，不能忽略蒙版生成")
	}
	if opts.APIMode == APIModeImages && opts.Mode != ModeEdit && (inputCount > 0 || opts.MaskB64 != "") {
		return fmt.Errorf("含参考图或蒙版的 Images API 请求必须使用编辑模式")
	}
	rule := opts.ModelCapabilities
	if rule == nil {
		return nil
	}
	if rule.MaxInputImages != nil && inputCount > *rule.MaxInputImages {
		return fmt.Errorf("当前模型与接口最多支持 %d 张参考图，已提供 %d 张", *rule.MaxInputImages, inputCount)
	}
	if opts.MaskB64 != "" && rule.SupportsMask != nil && !*rule.SupportsMask {
		return fmt.Errorf("当前模型与接口已确认不支持蒙版编辑")
	}
	for _, field := range []struct {
		name, value, fallback string
		allowed               []string
	}{
		{"质量", opts.Quality, DefaultQuality, rule.Qualities},
		{"尺寸", opts.Size, DefaultSize, rule.Sizes},
		{"输出格式", opts.OutputFormat, OutputFormat, rule.Formats},
	} {
		value := field.value
		if value == "" {
			value = field.fallback
		}
		if len(field.allowed) > 0 && !containsCapabilityValue(field.allowed, value) {
			return fmt.Errorf("当前模型与接口不支持%s %q；允许值：%s", field.name, value, strings.Join(field.allowed, ", "))
		}
	}
	fidelity := normalizeInputFidelity(opts.InputFidelity)
	if inputCount > 0 && supportsConfiguredInputFidelity(opts) && fidelity != DefaultInputFidelity && len(rule.InputFidelityValues) > 0 && !containsCapabilityValue(rule.InputFidelityValues, fidelity) {
		return fmt.Errorf("当前模型与接口不支持 input_fidelity=%s", fidelity)
	}
	return nil
}

func containsCapabilityValue(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
