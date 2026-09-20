package backend

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
 "github.com/wailsapp/wails/v2/pkg/runtime"
 "github.com/yuanhua/image-gptcodex/pkg/client"
 "image-studio/backend/internal/taskqueue"
)

// Credentials are held by request closures, never by durable task records.
func(s *Service)taskManager()(*taskqueue.Manager,error){
 if s.ctx==nil{return nil,errors.New("服务未启动")}
 s.taskOnce.Do(func(){root,err:=platformStableDataRoot();if err!=nil{s.taskErr=err;return};s.tasks,s.taskErr=taskqueue.New(s.ctx,taskqueue.FileRepository{Path:filepath.Join(root,"studio-v2","tasks.json")},s.onTaskChange)})
 return s.tasks,s.taskErr
}
func(s *Service)onTaskChange(r taskqueue.Record){
 runtime.EventsEmit(s.ctx,"task:changed",r);if r.Kind!="image"{return}
 switch r.Status{
 case taskqueue.Succeeded:var payload ResultPayload;if json.Unmarshal(r.Result,&payload)==nil{runtime.EventsEmit(s.ctx,"result:"+r.ID,payload)}
 case taskqueue.Failed,taskqueue.Cancelled,taskqueue.Interrupted:payload:=ErrorPayload{Message:r.Error};_=json.Unmarshal(r.Result,&payload);if payload.Message==""{payload.Message=r.Stage};runtime.EventsEmit(s.ctx,"error:"+r.ID,payload)
 }
}
func redactTaskFailure(result json.RawMessage,err error,keys ...string)(json.RawMessage,error){
 if err==nil{return result,nil};message:=err.Error();var payload ErrorPayload;_=json.Unmarshal(result,&payload)
 for _,key:=range keys{if key!=""{message=strings.ReplaceAll(message,key,"[REDACTED]");payload.Message=strings.ReplaceAll(payload.Message,key,"[REDACTED]")}}
 if len(message)>1000{message=message[:1000]};if len(result)>0{result,_=json.Marshal(payload)};return result,errors.New(message)
}
func(s *Service)ListTasks()([]taskqueue.Record,error){
 m,err:=s.taskManager();if err!=nil{return nil,err};list:=m.List()
 for _,r:=range list{if r.Kind=="video"&&r.Status==taskqueue.Succeeded{var result VideoTaskResult;if json.Unmarshal(r.Result,&result)==nil&&result.SavedPath!=""{if _,ok:=s.mediaAssetSnapshot(mediaIDForPath(result.SavedPath));!ok{_,_=s.RegisterVideoAsset(result.SavedPath)}}}}
 return list,nil
}
func(s *Service)GetTask(id string)(taskqueue.Record,error){m,err:=s.taskManager();if err!=nil{return taskqueue.Record{},err};return m.Get(id)}
type VideoTaskOptions struct{
 BaseURL string `json:"baseURL"`
 APIKey string `json:"apiKey"`
 ProfileID string `json:"profileId"`
 WorkspaceID string `json:"workspaceId"`
 RequestedJobID string `json:"requestedJobId,omitempty"`
 Provider string `json:"provider"`
 VideoModelID string `json:"videoModelID"`
 Prompt string `json:"prompt"`
 Seconds int `json:"seconds"`
 Size string `json:"size,omitempty"`
 AspectRatio string `json:"aspectRatio,omitempty"`
 Resolution string `json:"resolution,omitempty"`
 ReferencePath string `json:"referencePath,omitempty"`
}
type VideoTaskResult struct{
 SavedPath string `json:"savedPath"`
 MediaURL string `json:"mediaUrl"`
 Width int `json:"width"`
 Height int `json:"height"`
}
func(s *Service)resolveVideoTaskOptions(o VideoTaskOptions)(client.VideoJobOptions,error){
 key:=strings.TrimSpace(o.APIKey)
 if key==""&&o.ProfileID!=""{var err error;key,err=s.GetStoredAPIKey("profile:"+o.ProfileID);if err!=nil{return client.VideoJobOptions{},err}}
 req:=client.VideoJobOptions{BaseURL:o.BaseURL,APIKey:key,Protocol:o.Provider,Model:o.VideoModelID,Prompt:o.Prompt,Seconds:o.Seconds,Size:o.Size,AspectRatio:o.AspectRatio,Resolution:o.Resolution}
 if o.ReferencePath!=""{
  path,err:=s.ensureManagedReadablePath(o.ReferencePath,managedImageFile);if err!=nil{return req,err};info,err:=os.Stat(path);if err!=nil{return req,err};if info.Size()>20*1024*1024{return req,errors.New("参考图不能超过 20 MiB")}
  req.Reference,err=os.ReadFile(path);if err!=nil{return req,err};req.ReferenceName=filepath.Base(path)
 }
 return client.ValidateVideoJobOptions(req)
}
func(s *Service)SubmitVideoTask(o VideoTaskOptions)(taskqueue.Record,error){
 if !taskqueue.ValidID(o.WorkspaceID){return taskqueue.Record{},errors.New("请选择有效的工作区")};req,err:=s.resolveVideoTaskOptions(o);if err!=nil{return taskqueue.Record{},err}
 m,err:=s.taskManager();if err!=nil{return taskqueue.Record{},err};id:=o.RequestedJobID;if id==""{id,err=newJobID();if err!=nil{return taskqueue.Record{},err}}
 label:=[]rune(o.Prompt);if len(label)>160{label=label[:160]}
 record:=taskqueue.Record{ID:id,Kind:"video",Queue:"video",WorkspaceID:o.WorkspaceID,ProfileID:o.ProfileID,ModelID:req.Model,Provider:req.Protocol,BaseURL:req.BaseURL,Label:string(label)}
 return m.Submit(record,2,false,s.videoTaskRunner(id,req,""))
}
func(s *Service)ResumeVideoTask(id string,o VideoTaskOptions)(taskqueue.Record,error){
 m,err:=s.taskManager();if err!=nil{return taskqueue.Record{},err};r,err:=m.Get(id);if err!=nil{return r,err}
 // Resume only reads the existing remote task; generation settings are not resent.
 o.Prompt="resume";o.Seconds=1;o.ReferencePath="";req,err:=s.resolveVideoTaskOptions(o);if err!=nil{return r,err}
 if r.Kind!="video"||r.BaseURL!=req.BaseURL||r.Provider!=req.Protocol||r.ModelID!=req.Model||r.ProfileID!=o.ProfileID{return r,errors.New("请使用任务原来的上游配置恢复轮询")}
 return m.Resume(id,s.videoTaskRunner(id,req,r.RemoteID))
}
func(s *Service)videoTaskRunner(id string,req client.VideoJobOptions,remoteID string)taskqueue.Runner{
 return func(parent context.Context,report taskqueue.Reporter)(json.RawMessage,error){
  ctx,cancel:=context.WithTimeout(parent,30*time.Minute);defer cancel()
  run:=func()(json.RawMessage,error){
   var result client.VideoJob;var err error
   if remoteID==""{result,err=client.CreateVideoJob(ctx,req)}else{result,err=client.PollVideoJob(ctx,req,remoteID)};if err!=nil{return nil,err}
   if err=report(result.ID,"上游已接受任务");err!=nil{return nil,err};failures:=0
   for result.Status==client.VideoStatusQueued||result.Status==client.VideoStatusInProgress{
    if err=waitVideoTask(ctx,5*time.Second);err!=nil{return nil,err};next,pollErr:=client.PollVideoJob(ctx,req,result.ID)
    if pollErr!=nil{failures++;delay,retry:=client.VideoPollRetryDelay(pollErr,failures);if !retry||failures>=5{return nil,pollErr};if err=waitVideoTask(ctx,delay);err!=nil{return nil,err};continue}
    failures=0;result=next
   }
   if result.Status!=client.VideoStatusCompleted{return nil,fmt.Errorf("视频任务 %s: %s",result.Status,result.Error)}
   if err=report(result.ID,"正在保存视频到本地");err!=nil{return nil,err};root,err:=s.resolvedOutputDir();if err!=nil{return nil,err};path:=filepath.Join(root,"videos",id+".mp4")
   if err=client.SaveVideoJobMedia(ctx,req,result,path,512*1024*1024);err!=nil{return nil,err};mediaURL,err:=s.RegisterVideoAsset(path);if err!=nil{return nil,err}
   w,h:=1280,720;if req.Protocol=="xai"{w,h=16,9;if req.AspectRatio!=""{_,_=fmt.Sscanf(req.AspectRatio,"%d:%d",&w,&h)}}else if req.Size!=""{_,_=fmt.Sscanf(req.Size,"%dx%d",&w,&h)}
   return json.Marshal(VideoTaskResult{SavedPath:path,MediaURL:mediaURL,Width:w,Height:h})
  }
  result,err:=run();return redactTaskFailure(result,err,req.APIKey)
 }
}
func waitVideoTask(ctx context.Context,d time.Duration)error{timer:=time.NewTimer(d);defer timer.Stop();select{case <-ctx.Done():return ctx.Err();case <-timer.C:return nil}}
func(s *Service)RegisterVideoAsset(path string)(string,error){path,err:=s.ensureManagedReadablePath(path,managedVideoFile);if err!=nil{return "",err};if !strings.EqualFold(filepath.Ext(path),".mp4"){return "",errors.New("只支持托管 MP4 视频")};asset,err:=s.registerGeneratedMedia(path,"",0,0);return asset.FullURL,err}
