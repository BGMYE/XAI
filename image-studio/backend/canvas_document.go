package backend

import("encoding/json";"errors";"fmt";"image-studio/backend/internal/taskqueue";"io";"math";"net/url";"os";"path/filepath";"strings";"sync")
// CanvasDocument stores layout, not credentials, signed URLs or binary media.
type CanvasDocument struct{
 Version int `json:"version"`
 Revision uint64 `json:"revision"`
 ActiveWorkspaceID string `json:"activeWorkspaceId"`
 Workspaces []CanvasWorkspace `json:"workspaces"`
 AppliedVideoTaskIDs []string `json:"appliedVideoTaskIds"`
}
type CanvasWorkspace struct{
 ID string `json:"id"`
 Name string `json:"name"`
 Prompt string `json:"prompt"`
 Nodes []CanvasDocumentNode `json:"nodes"`
 Viewport CanvasDocumentViewport `json:"viewport"`
 SelectedNodeID string `json:"selectedNodeId"`
}
type CanvasDocumentViewport struct{X float64 `json:"x"`;Y float64 `json:"y"`;Scale float64 `json:"scale"`}
type CanvasDocumentNode struct{
 ID string `json:"id"`
 Type string `json:"type"`
 MediaID string `json:"mediaId,omitempty"`
 Src string `json:"src,omitempty"`
 SavedPath string `json:"savedPath,omitempty"`
 Label string `json:"label,omitempty"`
 X float64 `json:"x"`
 Y float64 `json:"y"`
 Width float64 `json:"width"`
 Height float64 `json:"height"`
 CreatedAt int64 `json:"createdAt"`
}
var canvasDocumentMu sync.Mutex
const maxCanvasDocumentBytes=16*1024*1024
func canvasDocumentPath()(string,error){root,err:=platformStableDataRoot();return filepath.Join(root,"studio-v2","canvas.json"),err}
func readCanvasDocument(path string)(CanvasDocument,error){
 empty:=CanvasDocument{Version:1,Workspaces:[]CanvasWorkspace{},AppliedVideoTaskIDs:[]string{}}
 f,err:=os.Open(path);if errors.Is(err,os.ErrNotExist){return empty,nil};if err!=nil{return empty,err};defer f.Close()
 data,err:=io.ReadAll(io.LimitReader(f,maxCanvasDocumentBytes+1));if err!=nil{return empty,err};if len(data)>maxCanvasDocumentBytes{return empty,errors.New("画布文档过大")}
 var doc CanvasDocument;if err=json.Unmarshal(data,&doc);err!=nil{return empty,fmt.Errorf("画布文档无法读取，原文件已保留: %w",err)};return doc,validateCanvasDocument(doc)
}
func(s *Service)LoadCanvasDocument()(CanvasDocument,error){canvasDocumentMu.Lock();defer canvasDocumentMu.Unlock();path,err:=canvasDocumentPath();if err!=nil{return CanvasDocument{},err};return readCanvasDocument(path)}
func(s *Service)SaveCanvasDocument(doc CanvasDocument,expectedRevision uint64)(CanvasDocument,error){canvasDocumentMu.Lock();defer canvasDocumentMu.Unlock();path,err:=canvasDocumentPath();if err!=nil{return doc,err};return saveCanvasDocument(path,doc,expectedRevision)}
func saveCanvasDocument(path string,doc CanvasDocument,expectedRevision uint64)(CanvasDocument,error){
 if err:=validateCanvasDocument(doc);err!=nil{return doc,err};current,err:=readCanvasDocument(path);if err!=nil{return doc,err}
 if current.Revision!=expectedRevision{return doc,errors.New("CANVAS_CONFLICT: 画布已被其他窗口修改，请重新打开应用后继续；未覆盖已有文档")}
 doc.Revision=current.Revision+1;data,err:=json.Marshal(doc);if err!=nil{return doc,err};if len(data)>maxCanvasDocumentBytes{return doc,errors.New("画布文档超过 16 MiB")};return doc,taskqueue.AtomicWrite(path,data)
}
func finiteCanvas(n,limit float64)bool{return !math.IsNaN(n)&&!math.IsInf(n,0)&&math.Abs(n)<=limit}
func validateCanvasDocument(doc CanvasDocument)error{
 if doc.Version!=1||doc.Revision>9007199254740000{return errors.New("不支持的画布文档版本")};if len(doc.Workspaces)>100||len(doc.AppliedVideoTaskIDs)>10000{return errors.New("画布文档条目过多")}
 ids:=map[string]bool{};nodes:=0
 for _,w:=range doc.Workspaces{
  if !taskqueue.ValidID(w.ID)||ids[w.ID]||len(w.Name)>512||len(w.Prompt)>128000{return errors.New("工作区字段无效")};ids[w.ID]=true
  if !finiteCanvas(w.Viewport.X,1e9)||!finiteCanvas(w.Viewport.Y,1e9)||w.Viewport.Scale<.05||w.Viewport.Scale>8||!finiteCanvas(w.Viewport.Scale,8){return errors.New("画布视口无效")}
  seen:=map[string]bool{}
  for _,n:=range w.Nodes{
   nodes++;if nodes>10000{return errors.New("画布节点总数超过 10000")}
   if n.ID==""||len(n.ID)>4096||seen[n.ID]||(n.Type!="image"&&n.Type!="video"){return errors.New("画布节点无效")};seen[n.ID]=true
   if !finiteCanvas(n.X,1e9)||!finiteCanvas(n.Y,1e9)||!finiteCanvas(n.Width,1e6)||!finiteCanvas(n.Height,1e6)||n.Width<=0||n.Height<=0{return errors.New("画布节点坐标或尺寸无效")}
   if len(n.Label)>4096||len(n.SavedPath)>8192||len(n.MediaID)>4096{return errors.New("画布节点字段过长")};if n.Src!=""&&!safeCanvasSource(n.Src){return errors.New("画布只保存本地媒体引用或无凭证 HTTPS 地址")}
  }
  if w.SelectedNodeID!=""&&!seen[w.SelectedNodeID]{return errors.New("选中的画布节点不存在")}
 }
 if len(doc.Workspaces)>0&&!ids[doc.ActiveWorkspaceID]{return errors.New("活动工作区不存在")};for _,id:=range doc.AppliedVideoTaskIDs{if !taskqueue.ValidID(id){return errors.New("无效的视频交付标识")}};return nil
}
func safeCanvasSource(src string)bool{if len(src)>8192{return false};if strings.HasPrefix(src,"/media/"){return !strings.ContainsAny(src,"?#\\")&&!strings.Contains(src,"..")};u,err:=url.Parse(src);return err==nil&&u.Scheme=="https"&&u.Host!=""&&u.User==nil&&u.RawQuery==""&&u.Fragment==""}
