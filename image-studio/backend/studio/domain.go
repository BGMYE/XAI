// Package studio contains the desktop-independent project and generation domain.
package studio

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"image-studio/backend/dlss5"
)

const SchemaVersion = 2

var ErrConflict = errors.New("画布已更新，请重新载入后保存（revision conflict）")
var validID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$`)

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("secure random unavailable")
	}
	return hex.EncodeToString(b[:])
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func checkID(id string) error {
	if !validID.MatchString(id) {
		return errors.New("无效标识符")
	}
	return nil
}

// Profile is an upstream configuration shared by the Studio and the classic
// editor. Fields after AllowLocal mirror the classic editor's options; the
// Studio uses those it can honor and ignores the rest.
type Profile struct {
	// A preset supplies guidance, not an assertion about upstream permissions.
	ProviderPreset string                     `json:"providerPreset,omitempty"`
	Capabilities   *ImageProviderCapabilities `json:"capabilities,omitempty"`
	ID             string                     `json:"id"`
	Name           string                     `json:"name"`
	BaseURL        string                     `json:"baseUrl"`
	ImageModel     string                     `json:"imageModel"`
	VideoModel     string                     `json:"videoModel"`
	Protocol       string                     `json:"protocol"`
	AllowLocal     bool                       `json:"allowLocal"`
	// ImageAPI selects the OpenAI-compatible image contract: the streamed
	// Images API ("images", the default) or the Responses API image tool
	// ("responses"), which is driven by TextModel.
	ImageAPI           string `json:"imageApi,omitempty"`
	ResponsesTransport string `json:"responsesTransport,omitempty"`
	RequestPolicy      string `json:"requestPolicy,omitempty"`
	ImagesNewAPICompat bool   `json:"imagesNewApiCompat,omitempty"`
	// AllowInsecure permits plain HTTP to a remote host and skips certificate
	// verification. It is an explicit opt-in for one upstream.
	AllowInsecure     bool     `json:"allowInsecure,omitempty"`
	TextModel         string   `json:"textModel,omitempty"`
	ReasoningEffort   string   `json:"reasoningEffort,omitempty"`
	ModelIDs          []string `json:"modelIds,omitempty"`
	ConcurrencyLimit  int      `json:"concurrencyLimit,omitempty"`
	FallbackProfileID string   `json:"fallbackProfileId,omitempty"`
	HasKey            bool     `json:"hasKey"`
	// Opaque reference, NEVER the secret itself. Jobs pin their credential version.
	CredentialID string `json:"credentialId,omitempty"`
	VerifiedAt   string `json:"verifiedAt,omitempty"`
	CreatedAt    string `json:"createdAt,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
}

const (
	// The model catalog caches every ID an upstream lists; the classic editor
	// merges them without a cap. Absurd entries are dropped and the list is
	// bounded rather than rejected, so a large catalog never blocks a save.
	maxModelIDs        = 5000
	maxModelIDBytes    = 256
	maxConcurrency     = 1000
	defaultImageAPI    = "images"
	responsesImageAPI  = "responses"
	defaultRequestMode = "openai"
)

func (p Profile) secretSlot() string {
	if p.CredentialID != "" {
		return p.CredentialID
	}
	return p.ID
}

// forJob is the copy a job pins: what is needed to run and resume it, without
// editor-only metadata such as the model catalog.
func (p Profile) forJob() Profile {
	p.ModelIDs = nil
	p.FallbackProfileID = ""
	p.VerifiedAt = ""
	return p
}

// connection reports the fields that decide where a key is sent. A change to
// any of them invalidates a successful connection test.
func (p Profile) connection() [4]string {
	return [4]string{p.BaseURL, p.Protocol, fmt.Sprint(p.AllowLocal), fmt.Sprint(p.AllowInsecure)}
}

// Validate normalizes and checks a profile. A profile may be saved before its
// address is known (the classic editor creates drafts that way); requests
// check that it is complete.
func (p *Profile) Validate() error {
	p.Name = strings.TrimSpace(p.Name)
	p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	p.ImageModel = strings.TrimSpace(p.ImageModel)
	p.VideoModel = strings.TrimSpace(p.VideoModel)
	p.TextModel = strings.TrimSpace(p.TextModel)
	p.FallbackProfileID = strings.TrimSpace(p.FallbackProfileID)
	if err := checkID(p.ID); err != nil {
		return err
	}
	if p.Name == "" || len(p.Name) > 160 {
		return errors.New("请输入上游名称（最多 160 字节）")
	}
	if p.Protocol != "openai" && p.Protocol != "xai" {
		return errors.New("请选择明确的接口协议")
	}
	if p.BaseURL != "" {
		u, err := url.Parse(p.BaseURL)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("Base URL 必须是无密钥、无查询参数的完整 API 根地址")
		}
		switch {
		case u.Scheme == "https":
		case u.Scheme == "http" && (p.AllowInsecure || (p.AllowLocal && isLoopbackHost(u.Hostname()))):
		default:
			return errors.New("上游必须使用 HTTPS；仅显式启用本地服务或不安全连接时允许 HTTP")
		}
	}
	switch p.ImageAPI {
	case "", defaultImageAPI, responsesImageAPI:
	default:
		return errors.New("图像接口只能是 Images API 或 Responses API")
	}
	if p.Protocol == "xai" && p.ImageAPI == responsesImageAPI {
		return errors.New("xAI 协议不支持 Responses API 图像接口")
	}
	switch p.ResponsesTransport {
	case "", "sse", "websocket":
	default:
		return errors.New("Responses 传输方式无效")
	}
	switch p.RequestPolicy {
	case "", defaultRequestMode, "compat":
	default:
		return errors.New("请求策略无效")
	}
	switch p.ReasoningEffort {
	case "", "low", "medium", "high", "xhigh":
	default:
		return errors.New("推理强度无效")
	}
	if p.ConcurrencyLimit < 0 || p.ConcurrencyLimit > maxConcurrency {
		return fmt.Errorf("并发上限必须为 0–%d", maxConcurrency)
	}
	if p.FallbackProfileID != "" && (checkID(p.FallbackProfileID) != nil || p.FallbackProfileID == p.ID) {
		return errors.New("备用上游无效")
	}
	p.ModelIDs = normalizeModelIDs(p.ModelIDs)
	if err := p.validateCapabilities(); err != nil {
		return err
	}
	if len(p.BaseURL) > 2048 || len(p.ImageModel) > 200 || len(p.VideoModel) > 200 || len(p.TextModel) > 200 {
		return errors.New("上游配置过长")
	}
	return nil
}

// normalizeModelIDs trims and deduplicates a model catalog in order, drops
// entries no upstream would use, and keeps at most maxModelIDs.
func normalizeModelIDs(ids []string) []string {
	models := make([]string, 0, min(len(ids), maxModelIDs))
	seen := make(map[string]bool, len(models))
	for _, m := range ids {
		m = strings.TrimSpace(m)
		if m == "" || len(m) > maxModelIDBytes || seen[m] {
			continue
		}
		seen[m] = true
		models = append(models, m)
		if len(models) == maxModelIDs {
			break
		}
	}
	if len(models) == 0 {
		return nil
	}
	return models
}

// usableFor explains why a profile cannot run a request of the given kind.
func (p Profile) usableFor(kind string) error {
	if p.BaseURL == "" {
		return errors.New("请先填写上游地址")
	}
	if !p.HasKey {
		return errors.New("请先保存 API Key")
	}
	if kind == "image" && p.ImageModel == "" {
		return errors.New("请显式配置图像模型 ID")
	}
	if kind == "image" && p.ImageAPI == responsesImageAPI && p.TextModel == "" {
		return errors.New("Responses API 需要填写文本模型 ID；不会使用默认模型替代")
	}
	if kind == "video" && p.VideoModel == "" {
		return errors.New("请显式配置视频模型 ID；不会使用图像模型替代")
	}
	return nil
}

// isLoopbackHost reports a loopback address or a localhost name, including
// subdomains such as api.localhost, which resolve to loopback (RFC 6761).
func isLoopbackHost(host string) bool {
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}
type Parameters struct {
	DLSS5         *dlss5.Options `json:"dlss5,omitempty"`
	PromptMode    string         `json:"promptMode,omitempty"`
	OutputFormat  string         `json:"outputFormat,omitempty"`
	InputFidelity string         `json:"inputFidelity,omitempty"`
	Quality       string         `json:"quality,omitempty"`
	EndpointPath  string         `json:"endpointPath,omitempty"`
	Size          string         `json:"size,omitempty"`
	Seconds       int            `json:"seconds,omitempty"`
	AspectRatio   string         `json:"aspectRatio,omitempty"`
	Resolution    string         `json:"resolution,omitempty"`
}
type Node struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"`
	X          float64    `json:"x"`
	Y          float64    `json:"y"`
	Title      string     `json:"title"`
	Text       string     `json:"text,omitempty"`
	AssetID    string     `json:"assetId,omitempty"`
	Parameters Parameters `json:"parameters"`
}
type Edge struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
}
type Project struct {
	DeletedAt string   `json:"deletedAt,omitempty"`
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Revision  int64    `json:"revision"`
	UpdatedAt string   `json:"updatedAt"`
	Viewport  Viewport `json:"viewport"`
	Nodes     []Node   `json:"nodes"`
	Edges     []Edge   `json:"edges"`
}

func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }

// Order checks finite geometry, unique IDs, dangling edges and DAG acyclicity.
func (p Project) Order() ([]string, error) {
	if err := checkID(p.ID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.Name) == "" || len(p.Name) > 200 {
		return nil, errors.New("画布名称无效")
	}
	if len(p.Nodes) > 2000 || len(p.Edges) > 4000 {
		return nil, errors.New("单个画布最多 2000 个节点、4000 条连线")
	}
	if !finite(p.Viewport.X) || !finite(p.Viewport.Y) || !finite(p.Viewport.Zoom) || p.Viewport.Zoom < .1 || p.Viewport.Zoom > 4 {
		return nil, errors.New("视口参数无效")
	}
	degree := map[string]int{}
	graph := map[string][]string{}
	kinds := map[string]string{}
	for _, n := range p.Nodes {
		if err := checkID(n.ID); err != nil {
			return nil, err
		}
		if _, ok := degree[n.ID]; ok {
			return nil, errors.New("节点 ID 重复")
		}
		if !finite(n.X) || !finite(n.Y) || math.Abs(n.X) > 1e7 || math.Abs(n.Y) > 1e7 {
			return nil, errors.New("节点坐标无效")
		}
		if len(n.Text) > 16000 || len(n.Title) > 200 {
			return nil, errors.New("节点文字过长")
		}
		switch n.Kind {
		case "prompt", "image", "video", "asset", "note":
		default:
			return nil, errors.New("未知节点类型")
		}
		if n.AssetID != "" {
			if err := checkID(n.AssetID); err != nil {
				return nil, err
			}
		}
		degree[n.ID] = 0
		kinds[n.ID] = n.Kind
	}
	seen := map[string]bool{}
	pairs := map[string]bool{}
	for _, e := range p.Edges {
		if err := checkID(e.ID); err != nil {
			return nil, err
		}
		_, fromOK := degree[e.From]
		_, toOK := degree[e.To]
		if !fromOK || !toOK || e.From == e.To || seen[e.ID] || pairs[e.From+":"+e.To] {
			return nil, errors.New("连线含悬空、重复或自连接")
		}
		if kinds[e.To] != "image" && kinds[e.To] != "video" && kinds[e.To] != "asset" {
			return nil, errors.New("连线目标必须是生成节点或结果节点")
		}
		seen[e.ID] = true
		pairs[e.From+":"+e.To] = true
		degree[e.To]++
		graph[e.From] = append(graph[e.From], e.To)
	}
	queue := []string{}
	for _, n := range p.Nodes {
		if degree[n.ID] == 0 {
			queue = append(queue, n.ID)
		}
	}
	order := []string{}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		order = append(order, id)
		for _, to := range graph[id] {
			degree[to]--
			if degree[to] == 0 {
				queue = append(queue, to)
			}
		}
	}
	if len(order) != len(p.Nodes) {
		return nil, errors.New("工作流不能形成循环")
	}
	return order, nil
}

type Request struct {
	AutoFallback      bool            `json:"autoFallback,omitempty"`
	UnsentRetries     int             `json:"unsentRetries,omitempty"`
	Source            string          `json:"source,omitempty"`
	Image             ImageParameters `json:"image,omitzero"`
	ReferenceAssetIDs []string        `json:"referenceAssetIds,omitempty"`
	MaskAssetID       string          `json:"maskAssetId,omitempty"`
	ID                string          `json:"id"`
	ProfileID         string          `json:"profileId"`
	ProjectID         string          `json:"projectId"`
	NodeID            string          `json:"nodeId,omitempty"`
	Kind              string          `json:"kind"`
	Prompt            string          `json:"prompt"`
	OriginalPrompt    string          `json:"originalPrompt,omitempty"`
	ConfirmedPrompt   string          `json:"confirmedPrompt,omitempty"`
	ReferenceAssetID  string          `json:"referenceAssetId,omitempty"`
	Parameters        Parameters      `json:"parameters"`
}

// ImageParameters contains generation choices only. Credentials and local file
// paths never enter a persisted request; references are immutable asset IDs.
type ImageParameters struct {
	Quality           string `json:"quality,omitempty"`
	OutputFormat      string `json:"outputFormat,omitempty"`
	Seed              int64  `json:"seed,omitempty"`
	NegativePrompt    string `json:"negativePrompt,omitempty"`
	Background        string `json:"background,omitempty"`
	OutputCompression int    `json:"outputCompression,omitempty"`
	InputFidelity     string `json:"inputFidelity,omitempty"`
	ImageStyle        string `json:"imageStyle,omitempty"`
	Moderation        string `json:"moderation,omitempty"`
	UserIdentifier    string `json:"userIdentifier,omitempty"`
	DisablePreview    bool   `json:"disablePreview,omitempty"`
	PartialImages     int    `json:"partialImages,omitempty"`
}

func (r Request) Validate(p Profile) error {
	if r.Parameters.DLSS5 != nil && r.Parameters.DLSS5.Enabled {
		if r.Kind != "video" {
			return errors.New("DLSS5 仅支持视频生成")
		}
		options := *r.Parameters.DLSS5
		if err := options.Validate(); err != nil {
			return err
		}
	}
	if r.Parameters.PromptMode != "" && r.Parameters.PromptMode != "verbatim" && r.Parameters.PromptMode != "assisted" {
		return errors.New("提示词模式只能是精确执行或创作辅助")
	}
	if r.Parameters.PromptMode == "assisted" && (r.Kind != "image" || p.Protocol != "openai" || p.ImageAPI != responsesImageAPI) {
		return errors.New("创作辅助需要 Responses 图像接口；Images 请先优化并确认提示词，再使用精确执行")
	}
	if len(r.OriginalPrompt) > 16000 || len(r.ConfirmedPrompt) > 16000 {
		return errors.New("提示词历史最多 16000 字节")
	}
	if r.ConfirmedPrompt != "" && r.ConfirmedPrompt != r.Prompt {
		return errors.New("已确认提示词必须与实际发送的提示词一致")
	}
	if r.Source != "" && r.Source != "classic" {
		return errors.New("未知任务来源")
	}
	referenceCount := len(r.ReferenceAssetIDs)
	if r.ReferenceAssetID != "" {
		referenceCount++
	}
	if referenceCount > 16 || len(r.Image.NegativePrompt) > 16000 || len(r.Image.UserIdentifier) > 512 {
		return errors.New("图像参数过长")
	}
	if (len(r.ReferenceAssetIDs) > 0 || r.MaskAssetID != "") && (r.Kind != "image" || p.Protocol != "openai") {
		return errors.New("多参考图与蒙版需要 OpenAI 图像协议")
	}
	for _, id := range []string{r.ID, r.ProfileID, r.ProjectID} {
		if err := checkID(id); err != nil {
			return err
		}
	}
	if r.NodeID != "" {
		if err := checkID(r.NodeID); err != nil {
			return err
		}
	}
	if r.Kind != "image" && r.Kind != "video" {
		return errors.New("仅支持图片或视频任务")
	}
	if strings.TrimSpace(r.Prompt) == "" || len(r.Prompt) > 16000 {
		return errors.New("提示词不能为空，且最多 16000 字节")
	}
	if err := p.usableFor(r.Kind); err != nil {
		return err
	}
	if err := validateImageCapabilities(p, r); err != nil {
		return err
	}
	if r.Kind == "video" && r.Parameters.Seconds != 0 {
		s := r.Parameters.Seconds
		if p.Protocol == "xai" && (s < 1 || s > 15) {
			return errors.New("xAI 视频时长必须为 1–15 秒")
		}
		if p.Protocol == "openai" {
			if r.Source == "classic" {
				if s < 1 || s > 60 {
					return errors.New("视频时长必须为 1–60 秒")
				}
			} else if s != 4 && s != 8 && s != 12 {
				return errors.New("OpenAI 视频协议时长必须为 4、8 或 12 秒")
			}
		}
	}
	if len(r.Parameters.Size) > 30 || len(r.Parameters.AspectRatio) > 10 || len(r.Parameters.Resolution) > 10 || len(r.Parameters.Quality) > 64 || len(r.Parameters.EndpointPath) > 2000 {
		return errors.New("生成参数无效")
	}
	return nil
}

type Asset struct {
	Width          int    `json:"width,omitempty"`
	Height         int    `json:"height,omitempty"`
	OriginalWidth  int    `json:"originalWidth,omitempty"`
	OriginalHeight int    `json:"originalHeight,omitempty"`
	ClassicPinned  bool   `json:"classicPinned,omitempty"`
	DeletedAt      string `json:"deletedAt,omitempty"`
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	MIME           string `json:"mime"`
	Bytes          int64  `json:"bytes"`
	CreatedAt      string `json:"createdAt"`
	FileName       string `json:"fileName"`
}

func (a Asset) URL() string { return "/studio-media/" + a.ID }

type Job struct {
	DLSS5           *DLSS5Job      `json:"dlss5,omitempty"`
	OriginalPrompt  string         `json:"originalPrompt,omitempty"`
	ConfirmedPrompt string         `json:"confirmedPrompt,omitempty"`
	SentPrompt      string         `json:"sentPrompt,omitempty"`
	ResponseID      string         `json:"responseId,omitempty"`
	RequestID       string         `json:"requestId,omitempty"`
	Usage           map[string]any `json:"usage,omitempty"`
	OutputStatus    string         `json:"outputStatus,omitempty"`
	ParentAssetIDs  []string       `json:"parentAssetIds,omitempty"`
	ResultAssetIDs  []string       `json:"resultAssetIds,omitempty"`
	ResultImages    []ResultImage  `json:"resultImages,omitempty"`
	HistoryMode     string         `json:"historyMode,omitempty"`
	FallbackProfile *Profile       `json:"fallbackProfile,omitempty"`
	RevisedPrompt   string         `json:"revisedPrompt,omitempty"`
	ID              string         `json:"id"`
	Request         Request        `json:"request"`
	Profile         Profile        `json:"profile"`
	Fingerprint     string         `json:"fingerprint"`
	State           string         `json:"state"`
	RemoteID        string         `json:"remoteId,omitempty"`
	Progress        int            `json:"progress"`
	Error           string         `json:"error,omitempty"`
	ResultAssetID   string         `json:"resultAssetId,omitempty"`
	// ResultURL is set once the upstream has produced an image but before it
	// is downloaded. It lets an interrupted download resume without
	// regenerating (and paying for) the image.
	ResultURL       string           `json:"resultUrl,omitempty"`
	ResultURLs      []string         `json:"resultUrls,omitempty"`
	ResultDownloads []ResultDownload `json:"resultDownloads,omitempty"`
	DependsOn       []string         `json:"dependsOn"`
	CreatedAt       string           `json:"createdAt"`
	UpdatedAt       string           `json:"updatedAt"`
}

// ResultImage stores generation-specific provenance separately from immutable,
// content-addressed assets, which may be reused by multiple jobs.
type ResultImage struct {
	AssetID       string `json:"assetId"`
	ItemID        string `json:"itemId,omitempty"`
	OutputIndex   *int   `json:"outputIndex,omitempty"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
	Source        string `json:"source"`
	Width         int    `json:"width,omitempty"`
	Height        int    `json:"height,omitempty"`
}

// ResultDownload pins final-image metadata with its recovery URL before any
// download, so a interrupted retrieval cannot lose upstream provenance.
type ResultDownload struct {
	URL           string `json:"url"`
	ItemID        string `json:"itemId,omitempty"`
	OutputIndex   *int   `json:"outputIndex,omitempty"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

func terminal(state string) bool {
	switch state {
	case "succeeded", "failed", "cancelled", "uncertain":
		return true
	}
	return false
}

type Snapshot struct {
	// Epoch and Revision let clients request deltas through Engine.Changes.
	Epoch       string       `json:"epoch"`
	Revision    uint64       `json:"revision"`
	PromptCards []PromptCard `json:"promptCards"`
	Profiles    []Profile    `json:"profiles"`
	Projects    []Project    `json:"projects"`
	Assets      []Asset      `json:"assets"`
	Jobs        []Job        `json:"jobs"`
}

func upstreamError(status int) error {
	switch status {
	case 401, 403:
		return fmt.Errorf("上游 HTTP %d：请检查 API Key 和模型权限", status)
	case 429:
		return errors.New("上游 HTTP 429：额度或请求频率受限")
	}
	return fmt.Errorf("上游 HTTP %d：请在服务商控制台核对请求（不记录原始响应以保护密钥）", status)
}
