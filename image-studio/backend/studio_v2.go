package backend

import (
 "context"
 "encoding/base64"
 "errors"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
 "sync"

 "image-studio/backend/studio"
 "github.com/wailsapp/wails/v2/pkg/runtime"
)

// StudioV2 is a thin Wails host. The core contains no Wails/runtime dependency.
// Old Service bindings remain available to the classic editor and Android path.
type StudioV2 struct {mu sync.Mutex;ctx context.Context;engine *studio.Engine;initErr error;keys apiKeyStore}
type studioSecrets struct{keys apiKeyStore}
func(s studioSecrets)Get(id string)(string,error){return s.keys.Get("api-key:studio-v2:"+id)}
func(s studioSecrets)Set(id,key string)error{return s.keys.Set("api-key:studio-v2:"+id,key)}
func(s studioSecrets)Delete(id string)error{return s.keys.Delete("api-key:studio-v2:"+id)}
func NewStudioV2(s *Service)*StudioV2{return &StudioV2{keys:s.apiKeys}}
func(s *StudioV2)Startup(ctx context.Context){
 s.mu.Lock();defer s.mu.Unlock();s.ctx=ctx
 dir,err:=os.UserConfigDir();if err!=nil{s.initErr=err;return}
 s.engine,s.initErr=studio.Open(filepath.Join(dir,"ImageStudio","studio-v2"),studioSecrets{s.keys},studio.Options{Workers:2})
}
func(s *StudioV2)Shutdown(_ context.Context){s.mu.Lock();e:=s.engine;s.mu.Unlock();if e!=nil{e.Close()}}
func(s *StudioV2)core()(*studio.Engine,error){s.mu.Lock();defer s.mu.Unlock();if s.initErr!=nil{return nil,s.initErr};if s.engine==nil{return nil,errors.New("工作室服务尚未启动")};return s.engine,nil}
func(s *StudioV2)GetSnapshot()(studio.Snapshot,error){e,err:=s.core();if err!=nil{return studio.Snapshot{},err};return e.Snapshot()}
func(s *StudioV2)SaveProfile(p studio.Profile,key string)(studio.Profile,error){e,err:=s.core();if err!=nil{return studio.Profile{},err};return e.SaveProfile(p,key)}
func(s *StudioV2)DeleteProfile(id string)error{e,err:=s.core();if err!=nil{return err};return e.DeleteProfile(id)}
func(s *StudioV2)TestProfile(id string)([]string,error){e,err:=s.core();if err!=nil{return nil,err};s.mu.Lock();ctx:=s.ctx;s.mu.Unlock();return e.TestProfile(ctx,id)}
func(s *StudioV2)SaveProject(p studio.Project)(studio.Project,error){e,err:=s.core();if err!=nil{return studio.Project{},err};return e.SaveProject(p)}
func(s *StudioV2)SubmitGeneration(r studio.Request)(studio.Job,error){e,err:=s.core();if err!=nil{return studio.Job{},err};return e.Submit(r)}
func(s *StudioV2)RunWorkflow(projectID,profileID,runID string)([]studio.Job,error){e,err:=s.core();if err!=nil{return nil,err};return e.RunWorkflow(projectID,profileID,runID)}
func(s *StudioV2)CancelJob(id string)error{e,err:=s.core();if err!=nil{return err};return e.Cancel(id)}
func(s *StudioV2)ResumeJob(id string)error{e,err:=s.core();if err!=nil{return err};return e.Resume(id)}
func(s *StudioV2)ImportImage(dataURL,name string)(studio.Asset,error){
 e,err:=s.core();if err!=nil{return studio.Asset{},err};if len(dataURL)>28*1024*1024{return studio.Asset{},errors.New("导入图片最大 20 MB")}
 head,data,ok:=strings.Cut(dataURL,",");if !ok{return studio.Asset{},errors.New("图片数据无效")}
 switch head{case "data:image/png;base64","data:image/jpeg;base64","data:image/webp;base64","data:image/gif;base64":default:return studio.Asset{},errors.New("仅接受 PNG、JPEG、WebP、GIF 图片")}
 b,err:=base64.StdEncoding.DecodeString(data);if err!=nil{return studio.Asset{},errors.New("图片编码无效")};return e.Import(b,name)
}
func(s *StudioV2)MediaHandler(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){if !strings.HasPrefix(r.URL.Path,"/studio-media/"){next.ServeHTTP(w,r);return};e,err:=s.core();if err!=nil{http.Error(w,"Studio unavailable",http.StatusServiceUnavailable);return};e.MediaHandler(next).ServeHTTP(w,r)})}
func(s *StudioV2)SaveAsset(id string)(bool,error){
 e,err:=s.core();if err!=nil{return false,err};snapshot,err:=e.Snapshot();if err!=nil{return false,err}
 var asset studio.Asset;for _,a:=range snapshot.Assets{if a.ID==id{asset=a;break}};if asset.ID==""{return false,errors.New("素材不存在")}
 s.mu.Lock();ctx:=s.ctx;s.mu.Unlock();ext:=filepath.Ext(asset.FileName)
 path,err:=runtime.SaveFileDialog(ctx,runtime.SaveDialogOptions{Title:"保存作品",DefaultFilename:"xai-"+asset.ID[:8]+ext,Filters:[]runtime.FileFilter{{DisplayName:asset.Kind,Pattern:"*"+ext}}});if err!=nil||path==""{return false,err}
 // Stage output next to the destination; do not truncate an existing file until
 // the full copy is successful. The save dialog owns overwrite confirmation.
 f,err:=os.CreateTemp(filepath.Dir(path),".xai-save-*");if err!=nil{return false,err};tmp:=f.Name();defer os.Remove(tmp)
 if err=f.Chmod(0600);err==nil{err=e.CopyAssetTo(id,f)};if err==nil{err=f.Sync()};closeErr:=f.Close();if err==nil{err=closeErr};if err!=nil{return false,err}
 if err=os.Rename(tmp,path);err!=nil{return false,err};return true,nil
}
// Compile-time check: copied assets stream into a writer, not a browser path.
var _ io.Writer = (*os.File)(nil)
