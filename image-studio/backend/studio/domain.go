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
)

const SchemaVersion = 1
var ErrConflict = errors.New("画布已更新，请重新载入后保存（revision conflict）")
var validID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$`)
func NewID() string { var b [16]byte; if _,err:=rand.Read(b[:]);err!=nil {panic("secure random unavailable")};return hex.EncodeToString(b[:]) }
func now() string {return time.Now().UTC().Format(time.RFC3339Nano)}
func checkID(id string) error {if !validID.MatchString(id){return errors.New("无效标识符")};return nil}

type Profile struct {
 ID string `json:"id"`
 Name string `json:"name"`
 BaseURL string `json:"baseUrl"`
 ImageModel string `json:"imageModel"`
 VideoModel string `json:"videoModel"`
 Protocol string `json:"protocol"`
 AllowLocal bool `json:"allowLocal"`
 HasKey bool `json:"hasKey"`
 // Opaque reference, NEVER the secret itself. Jobs pin their credential version.
 CredentialID string `json:"credentialId,omitempty"`
 VerifiedAt string `json:"verifiedAt,omitempty"`
 UpdatedAt string `json:"updatedAt"`
}
func (p Profile) secretSlot() string {if p.CredentialID!=""{return p.CredentialID};return p.ID}
func (p *Profile) Validate() error {
 p.Name=strings.TrimSpace(p.Name);p.BaseURL=strings.TrimRight(strings.TrimSpace(p.BaseURL),"/");p.ImageModel=strings.TrimSpace(p.ImageModel);p.VideoModel=strings.TrimSpace(p.VideoModel)
 if err:=checkID(p.ID);err!=nil{return err}
 if p.Name==""||len(p.Name)>160{return errors.New("请输入上游名称（最多 160 字节）")}
 if p.Protocol!="openai"&&p.Protocol!="xai"{return errors.New("请选择明确的接口协议")}
 u,err:=url.Parse(p.BaseURL)
 if err!=nil||u.Hostname()==""||u.User!=nil||u.RawQuery!=""||u.Fragment!=""{return errors.New("Base URL 必须是无密钥、无查询参数的完整 API 根地址")}
 if u.Scheme!="https"&&!(p.AllowLocal&&u.Scheme=="http"&&isLoopbackHost(u.Hostname())){return errors.New("上游必须使用 HTTPS；仅显式启用本地服务时允许回环 HTTP")}
 if len(p.BaseURL)>2048||len(p.ImageModel)>200||len(p.VideoModel)>200{return errors.New("上游配置过长")}
 return nil
}
func isLoopbackHost(host string) bool {if strings.EqualFold(host,"localhost"){return true};ip:=net.ParseIP(host);return ip!=nil&&ip.IsLoopback()}

type Viewport struct {X float64 `json:"x"`;Y float64 `json:"y"`;Zoom float64 `json:"zoom"`}
type Parameters struct {Size string `json:"size,omitempty"`;Seconds int `json:"seconds,omitempty"`;AspectRatio string `json:"aspectRatio,omitempty"`;Resolution string `json:"resolution,omitempty"`}
type Node struct {ID string `json:"id"`;Kind string `json:"kind"`;X float64 `json:"x"`;Y float64 `json:"y"`;Title string `json:"title"`;Text string `json:"text,omitempty"`;AssetID string `json:"assetId,omitempty"`;Parameters Parameters `json:"parameters"`}
type Edge struct {ID string `json:"id"`;From string `json:"from"`;To string `json:"to"`}
type Project struct {ID string `json:"id"`;Name string `json:"name"`;Revision int64 `json:"revision"`;UpdatedAt string `json:"updatedAt"`;Viewport Viewport `json:"viewport"`;Nodes []Node `json:"nodes"`;Edges []Edge `json:"edges"`}
func finite(n float64)bool{return !math.IsNaN(n)&&!math.IsInf(n,0)}

// Order checks finite geometry, unique IDs, dangling edges and DAG acyclicity.
func(p Project)Order()([]string,error){
 if err:=checkID(p.ID);err!=nil{return nil,err}
 if strings.TrimSpace(p.Name)==""||len(p.Name)>200{return nil,errors.New("画布名称无效")}
 if len(p.Nodes)>2000||len(p.Edges)>4000{return nil,errors.New("单个画布最多 2000 个节点、4000 条连线")}
 if !finite(p.Viewport.X)||!finite(p.Viewport.Y)||!finite(p.Viewport.Zoom)||p.Viewport.Zoom<.1||p.Viewport.Zoom>4{return nil,errors.New("视口参数无效")}
 degree:=map[string]int{};graph:=map[string][]string{};kinds:=map[string]string{}
 for _,n:=range p.Nodes{
  if err:=checkID(n.ID);err!=nil{return nil,err};if _,ok:=degree[n.ID];ok{return nil,errors.New("节点 ID 重复")}
  if !finite(n.X)||!finite(n.Y)||math.Abs(n.X)>1e7||math.Abs(n.Y)>1e7{return nil,errors.New("节点坐标无效")}
  if len(n.Text)>16000||len(n.Title)>200{return nil,errors.New("节点文字过长")}
  switch n.Kind{case "prompt","image","video","asset","note":default:return nil,errors.New("未知节点类型")}
  if n.AssetID!=""{if err:=checkID(n.AssetID);err!=nil{return nil,err}}
  degree[n.ID]=0;kinds[n.ID]=n.Kind
 }
 seen:=map[string]bool{};pairs:=map[string]bool{}
 for _,e:=range p.Edges{
  if err:=checkID(e.ID);err!=nil{return nil,err};_,fromOK:=degree[e.From];_,toOK:=degree[e.To]
  if !fromOK||!toOK||e.From==e.To||seen[e.ID]||pairs[e.From+":"+e.To]{return nil,errors.New("连线含悬空、重复或自连接")}
  if kinds[e.To]!="image"&&kinds[e.To]!="video"&&kinds[e.To]!="asset"{return nil,errors.New("连线目标必须是生成节点或结果节点")}
  seen[e.ID]=true;pairs[e.From+":"+e.To]=true;degree[e.To]++;graph[e.From]=append(graph[e.From],e.To)
 }
 queue:=[]string{};for _,n:=range p.Nodes{if degree[n.ID]==0{queue=append(queue,n.ID)}}
 order:=[]string{};for len(queue)>0{id:=queue[0];queue=queue[1:];order=append(order,id);for _,to:=range graph[id]{degree[to]--;if degree[to]==0{queue=append(queue,to)}}}
 if len(order)!=len(p.Nodes){return nil,errors.New("工作流不能形成循环")};return order,nil
}

type Request struct {ID string `json:"id"`;ProfileID string `json:"profileId"`;ProjectID string `json:"projectId"`;NodeID string `json:"nodeId,omitempty"`;Kind string `json:"kind"`;Prompt string `json:"prompt"`;ReferenceAssetID string `json:"referenceAssetId,omitempty"`;Parameters Parameters `json:"parameters"`}
func(r Request)Validate(p Profile)error{
 for _,id:=range []string{r.ID,r.ProfileID,r.ProjectID}{if err:=checkID(id);err!=nil{return err}}
 if r.NodeID!=""{if err:=checkID(r.NodeID);err!=nil{return err}}
 if r.Kind!="image"&&r.Kind!="video"{return errors.New("仅支持图片或视频任务")}
 if strings.TrimSpace(r.Prompt)==""||len(r.Prompt)>16000{return errors.New("提示词不能为空，且最多 16000 字节")}
 if !p.HasKey{return errors.New("请先保存 API Key")}
 if r.Kind=="image"&&p.ImageModel==""{return errors.New("请显式配置图像模型 ID")}
 if r.Kind=="video"&&p.VideoModel==""{return errors.New("请显式配置视频模型 ID；不会使用图像模型替代")}
 if r.Kind=="video"&&r.Parameters.Seconds!=0{s:=r.Parameters.Seconds;if p.Protocol=="xai"&&(s<1||s>15){return errors.New("xAI 视频时长必须为 1–15 秒")};if p.Protocol=="openai"&&s!=4&&s!=8&&s!=12{return errors.New("OpenAI 视频协议时长必须为 4、8 或 12 秒")}}
 if len(r.Parameters.Size)>30||len(r.Parameters.AspectRatio)>10||len(r.Parameters.Resolution)>10{return errors.New("生成参数无效")}
 return nil
}
type Asset struct {ID string `json:"id"`;Kind string `json:"kind"`;Name string `json:"name"`;MIME string `json:"mime"`;Bytes int64 `json:"bytes"`;CreatedAt string `json:"createdAt"`;FileName string `json:"fileName"`}
func(a Asset)URL()string{return "/studio-media/"+a.ID}
type Job struct {ID string `json:"id"`;Request Request `json:"request"`;Profile Profile `json:"profile"`;Fingerprint string `json:"fingerprint"`;State string `json:"state"`;RemoteID string `json:"remoteId,omitempty"`;Progress int `json:"progress"`;Error string `json:"error,omitempty"`;ResultAssetID string `json:"resultAssetId,omitempty"`;DependsOn []string `json:"dependsOn"`;CreatedAt string `json:"createdAt"`;UpdatedAt string `json:"updatedAt"`}
func terminal(state string)bool{switch state{case "succeeded","failed","cancelled","uncertain":return true};return false}
func(j Job)model()string{if j.Request.Kind=="video"{return j.Profile.VideoModel};return j.Profile.ImageModel}
type Snapshot struct {PromptCards []PromptCard `json:"promptCards"`;Profiles []Profile `json:"profiles"`;Projects []Project `json:"projects"`;Assets []Asset `json:"assets"`;Jobs []Job `json:"jobs"`}
func upstreamError(status int)error{switch status{case 401,403:return fmt.Errorf("上游 HTTP %d：请检查 API Key 和模型权限",status);case 429:return errors.New("上游 HTTP 429：额度或请求频率受限")};return fmt.Errorf("上游 HTTP %d：请在服务商控制台核对请求（不记录原始响应以保护密钥）",status)}
