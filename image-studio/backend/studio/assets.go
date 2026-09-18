package studio

import (
 "errors"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
)

func(e *Engine)makeAsset(output Output,name,kind string)(Asset,error){
 if len(output.Data)==0||len(output.Data)>160*1024*1024{return Asset{},errors.New("素材为空或超过 160 MB")}
 mime:=http.DetectContentType(output.Data);exts:=map[string]string{"image/png":".png","image/jpeg":".jpg","image/webp":".webp","image/gif":".gif","video/mp4":".mp4","video/webm":".webm"};ext,ok:=exts[mime]
 if !ok||!strings.HasPrefix(mime,kind+"/"){return Asset{},errors.New("上游素材不是支持的图片或视频文件")}
 a:=Asset{ID:NewID(),Kind:kind,Name:name,MIME:mime,Bytes:int64(len(output.Data)),CreatedAt:now()};a.FileName=a.ID+ext
 if err:=atomicWrite(filepath.Join(e.repo.root,"media",a.FileName),output.Data);err!=nil{return Asset{},err};return a,nil
}
func(e *Engine)finish(j Job,output Output)error{
 name:="生成图片";if j.Request.Kind=="video"{name="生成视频"};a,err:=e.makeAsset(output,name,j.Request.Kind)
 if err!=nil{return e.mutate(func(d *document)error{j.State="failed";j.Error=err.Error();j.UpdatedAt=now();d.Jobs[j.ID]=j;return nil})}
 err=e.mutate(func(d *document)error{
  d.Assets[a.ID]=a;j.State="succeeded";j.Progress=100;j.Error="";j.ResultAssetID=a.ID;j.UpdatedAt=now();d.Jobs[j.ID]=j
  p,ok:=d.Projects[j.Request.ProjectID];if ok&&len(p.Nodes)<2000&&len(p.Edges)<4000{
   x,y:=80.0+float64(len(p.Nodes)%4)*320,80.0+float64(len(p.Nodes)/4)*280;sourceExists:=false
   for _,n:=range p.Nodes{if n.ID==j.Request.NodeID{x=n.X+340;y=n.Y;sourceExists=true}}
   // Keep successive generated outputs visible rather than stacking them.
   for{overlap:=false;for _,n:=range p.Nodes{if x-n.X<260&&n.X-x<260&&y-n.Y<240&&n.Y-y<240{overlap=true;break}};if !overlap{break};y+=270}
   node:=Node{ID:NewID(),Kind:"asset",X:x,Y:y,Title:name,AssetID:a.ID};p.Nodes=append(p.Nodes,node)
   if sourceExists{p.Edges=append(p.Edges,Edge{NewID(),j.Request.NodeID,node.ID})};p.Revision++;p.UpdatedAt=now();d.Projects[p.ID]=p
  };return nil})
 if err!=nil{_ = os.Remove(filepath.Join(e.repo.root,"media",a.FileName))};return err
}
func(e *Engine)Import(data []byte,name string)(Asset,error){
 e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return Asset{},err};if len(data)>20*1024*1024{return Asset{},errors.New("导入图片最大 20 MB")};name=filepath.Base(name);if len(name)>200{name="参考图片"}
 a,err:=e.makeAsset(Output{Data:data},name,"image");if err!=nil{return Asset{},err};err=e.mutate(func(d *document)error{d.Assets[a.ID]=a;return nil});if err!=nil{_ = os.Remove(filepath.Join(e.repo.root,"media",a.FileName))};return a,err
}
func safeAsset(a Asset,id string)bool{return checkID(id)==nil&&a.ID==id&&filepath.Base(a.FileName)==a.FileName&&strings.HasPrefix(a.FileName,id+".")}
// Only opaque, registered IDs are served, with Range support for video seeking.
func(e *Engine)MediaHandler(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
 if !strings.HasPrefix(r.URL.Path,"/studio-media/"){next.ServeHTTP(w,r);return};if r.Method!="GET"&&r.Method!="HEAD"{w.Header().Set("Allow","GET, HEAD");w.WriteHeader(http.StatusMethodNotAllowed);return}
 id:=strings.TrimPrefix(r.URL.Path,"/studio-media/");e.mu.Lock();a,ok:=e.db.Assets[id];e.mu.Unlock();if !ok||!safeAsset(a,id){http.NotFound(w,r);return}
 f,err:=os.Open(filepath.Join(e.repo.root,"media",a.FileName));if err!=nil{http.NotFound(w,r);return};defer f.Close();stat,err:=f.Stat();if err!=nil{http.NotFound(w,r);return}
 w.Header().Set("Content-Type",a.MIME);w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("Cache-Control","private, max-age=3600");http.ServeContent(w,r,a.FileName,stat.ModTime(),f)
})}
// Destination comes only from the desktop Save dialog. The source is never an
// arbitrary filesystem path supplied by the browser.
func(e *Engine)CopyAssetTo(id string,dst io.Writer)error{e.mu.Lock();a,ok:=e.db.Assets[id];e.mu.Unlock();if !ok||!safeAsset(a,id){return errors.New("素材不存在")};f,err:=os.Open(filepath.Join(e.repo.root,"media",a.FileName));if err!=nil{return err};defer f.Close();_,err=io.Copy(dst,f);return err}
