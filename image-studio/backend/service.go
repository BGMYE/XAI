// Package backend exposes GUI-facing Wails bindings. Protocol implementations
// live in go-cli/pkg/client; taskqueue owns scheduling and durable task state.
package backend

import (
 "context"
 "crypto/rand"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "sync"
 "image-studio/backend/internal/taskqueue"
 "github.com/wailsapp/wails/v2/pkg/runtime"
 "github.com/yuanhua/image-gptcodex/pkg/client"
)

type Service struct {
 ctx context.Context
 mu sync.Mutex
 taskOnce sync.Once
 tasks *taskqueue.Manager
 taskErr error
 outputDir string
 keepLogs bool
 cleanupPreviewCacheOnExit bool
 apiKeys apiKeyStore
 trustedOutputRoots map[string]struct{}
 mediaAssets map[string]mediaAsset
 promptImportListenerReady bool
 pendingPromptImportTokens []string
 pendingPromptImportInvalidCount int
}
func NewService()*Service{
 return &Service{apiKeys:keyringAPIKeyStore{},trustedOutputRoots:map[string]struct{}{},mediaAssets:map[string]mediaAsset{}}
}
func(s *Service)Startup(ctx context.Context){
 s.ctx=ctx
 s.loadCompatibilitySettings()
 s.HandlePromptImportArgs(os.Args[1:])
 if strings.TrimSpace(os.Getenv(appUpdateProbePathEnv))!=""||commandLineArgValue(os.Args[1:],appUpdateProbePathArg)!=""{go s.captureAppUpdateProbe()}
}
func(s *Service)captureAppUpdateProbe(){
 appVersion,err:=currentDesktopAppVersion();if err!=nil||strings.TrimSpace(appVersion)==""{appVersion=defaultAppVersion}
 result:=AppUpdateProbeResult{AppVersion:appVersion,CurrentVersion:appVersion,UpdateInfoAvailable:false,HasUpdate:false,ShouldShowUpdate:false,AppUpdateModalOpen:false}
 updateInfo,err:=s.CheckForAppUpdate()
 if err==nil{result.CurrentVersion=updateInfo.CurrentVersion;result.LatestVersion=updateInfo.LatestVersion;result.ReleaseTag=updateInfo.ReleaseTag;result.ReleaseURL=updateInfo.ReleaseURL;result.UpdateInfoAvailable=true;result.HasUpdate=updateInfo.HasUpdate;result.ShouldShowUpdate=updateInfo.HasUpdate;result.AppUpdateModalOpen=updateInfo.HasUpdate}
 _=s.WriteAppUpdateProbe(result)
}
func(s *Service)resolvedOutputDir()(string,error){
 s.mu.Lock();custom:=s.outputDir;s.mu.Unlock()
 if custom!=""{if err:=os.MkdirAll(custom,secureDirMode);err!=nil{return "",fmt.Errorf("无法创建输出目录 %s: %w",custom,err)};s.addTrustedOutputRoot(custom);return custom,nil}
 root,err:=defaultOutputDir();if err==nil{s.addTrustedOutputRoot(root)};return root,err
}
func(s *Service)SetOutputDir(path string)error{
 if strings.TrimSpace(path)==""{s.mu.Lock();s.outputDir="";s.mu.Unlock();return nil}
 clean,err:=filepath.Abs(path);if err!=nil{return fmt.Errorf("路径无效:%w",err)}
 if err:=os.MkdirAll(clean,secureDirMode);err!=nil{return fmt.Errorf("无法创建输出目录 %s: %w",clean,err)}
 s.mu.Lock();s.outputDir=clean;s.mu.Unlock();s.addTrustedOutputRoot(clean);return nil
}
func(s *Service)ChooseOutputDir()(string,error){
 if s.ctx==nil{return "",errors.New("服务未启动")}
 chosen,err:=runtime.OpenDirectoryDialog(s.ctx,runtime.OpenDialogOptions{Title:"选择生成素材的保存目录"});if err!=nil{return "",err};if chosen==""{return "",nil};if err:=s.SetOutputDir(chosen);err!=nil{return "",err};return chosen,nil
}
func(s *Service)ChooseDirectory(title string)(string,error){if s.ctx==nil{return "",errors.New("服务未启动")};return runtime.OpenDirectoryDialog(s.ctx,runtime.OpenDialogOptions{Title:strings.TrimSpace(title)})}
func(s *Service)BuildBatchOutputPath(sourcePath,outputDir,prefix string)(string,error){
 cleanSource:=strings.TrimSpace(sourcePath);if cleanSource==""{return "",errors.New("源文件不能为空")}
 targetRoot:=strings.TrimSpace(outputDir);if targetRoot==""{targetRoot=filepath.Dir(cleanSource)}
 root,err:=ensureTargetDirectory(targetRoot);if err!=nil{return "",err};return uniquePrefixedTargetPath(root,filepath.Base(cleanSource),prefix)
}
// Generate/Edit retain their original binding signatures and event contracts.
func(s *Service)Generate(opts GenerateOptions)(JobStarted,error){opts.Mode="generate";return s.startJob(opts)}
func(s *Service)Edit(opts GenerateOptions)(JobStarted,error){opts.Mode="edit";if len(opts.collectPaths())==0{return JobStarted{},errors.New("edit 模式必须提供至少一张源图片")};return s.startJob(opts)}
func(s *Service)OptimizePrompt(opts PromptOptimizeOptions)(string,error){
 if s.ctx==nil{return "",errors.New("服务未启动")};if strings.TrimSpace(opts.APIKey)==""{return "",errors.New("API Key 不能为空")}
 operation:=strings.TrimSpace(opts.Mode)
 if operation!="describe"&&strings.TrimSpace(opts.Prompt)==""{return "",errors.New("提示词不能为空")}
 if operation=="describe"&&len(opts.collectPaths())==0{return "",errors.New("图片反推必须提供画布图片")}
 baseURL,err:=client.ValidateBaseURLWithSecurity(opts.BaseURL,opts.AllowInsecureConnection);if err!=nil{return "",err}
 refPaths,cleanup,err:=prepareUploadSourcePaths(opts.collectPaths());if err!=nil{return "",err};defer cleanup()
 modelID:=strings.TrimSpace(opts.TextModelID);if modelID==""{modelID=client.TextModel}
 proxyConfig,err:=client.NormalizeProxyConfig(opts.ProxyMode,opts.ProxyURL);if err!=nil{return "",err}
 return optimizePromptWithLLM(s.ctx,baseURL,opts.APIKey,modelID,opts.Mode,opts.Prompt,refPaths,proxyConfig,opts.AllowInsecureConnection)
}
// Cancel stops a local task; upstream cancellation is provider-dependent.
func(s *Service)Cancel(jobID string)error{manager,err:=s.taskManager();if err!=nil{return err};return manager.Cancel(jobID)}
func(o GenerateOptions)collectPaths()[]string{paths:=make([]string,0,len(o.ImagePaths)+1);for _,p:=range o.ImagePaths{if strings.TrimSpace(p)!=""{paths=append(paths,p)}};if strings.TrimSpace(o.ImagePath)!=""{paths=append(paths,o.ImagePath)};return paths}
func(s *Service)startJob(opts GenerateOptions)(JobStarted,error){
 if strings.TrimSpace(opts.APIKey)==""{return JobStarted{},errors.New("API Key 不能为空")};if strings.TrimSpace(opts.Prompt)==""{return JobStarted{},errors.New("提示词/修改要求不能为空")}
 manager,err:=s.taskManager();if err!=nil{return JobStarted{},err}
 id:=strings.TrimSpace(opts.RequestedJobID);if id==""{id,err=newJobID();if err!=nil{return JobStarted{},err}}
 record,err:=manager.Submit(taskqueue.Record{ID:id,Kind:"image",Queue:normaliseAPIMode(opts.APIMode),ModelID:opts.ImageModelID},opts.ConcurrencyLimit,true,func(ctx context.Context,_ taskqueue.Reporter)(json.RawMessage,error){
  result,runErr:=s.runImageJob(ctx,id,opts);keys:=[]string{opts.APIKey};if opts.FallbackProfile!=nil{keys=append(keys,opts.FallbackProfile.APIKey)};return redactTaskFailure(result,runErr,keys...)
 });if err!=nil{return JobStarted{},err};return JobStarted{JobID:record.ID},nil
}
func(s *Service)emitError(jobID string,err error){runtime.EventsEmit(s.ctx,"error:"+jobID,ErrorPayload{Message:err.Error()})}
func(s *Service)emitErrorWithRaw(jobID string,err error,rawPath string){abs:=rawPath;if rawPath!=""{if a,e:=filepath.Abs(rawPath);e==nil{abs=a}};runtime.EventsEmit(s.ctx,"error:"+jobID,ErrorPayload{Message:err.Error(),RawPath:abs})}
func normaliseAPIMode(mode string)string{switch strings.TrimSpace(mode){case string(client.APIModeImages):return string(client.APIModeImages);default:return string(client.APIModeResponses)}}
func normaliseConcurrencyLimit(limit int)int{if limit<0{return 0};return limit}
func apiModeLabel(mode string)string{if mode==string(client.APIModeImages){return "Images API"};return "Responses API"}
func shouldRouteFallbackAttempt(err error,rawPath string)bool{
 if err==nil{return false};if rawPath!=""{if rawBytes,readErr:=os.ReadFile(rawPath);readErr==nil&&client.IsRetryable(string(rawBytes)){return true}}
 lower:=strings.ToLower(err.Error());for _,marker:=range []string{"connection reset","eof","timeout","deadline exceeded","i/o timeout","tls handshake","no such host","upstream connect error","gateway"}{if strings.Contains(lower,marker){return true}};return false
}
func newJobID()(string,error){var b [12]byte;if _,err:=rand.Read(b[:]);err!=nil{return "",err};return hex.EncodeToString(b[:]),nil}
