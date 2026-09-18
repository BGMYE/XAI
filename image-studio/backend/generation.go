// Image request orchestration is separate from host bindings and task scheduling.
package backend

import (
 "context"
 "encoding/json"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
 "github.com/wailsapp/wails/v2/pkg/runtime"
 "github.com/yuanhua/image-gptcodex/pkg/client"
)
func generationFailure(err error,raw string)(json.RawMessage,error){if raw!=""{if abs,e:=filepath.Abs(raw);e==nil{raw=abs}};payload,_:=json.Marshal(ErrorPayload{Message:err.Error(),RawPath:raw});return payload,err}
func(s *Service)runImageJob(ctx context.Context,jobID string,opts GenerateOptions)(json.RawMessage,error){
 mode:=client.ModeGenerate;if opts.Mode=="edit"{mode=client.ModeEdit}
 apiMode:=client.APIMode(opts.APIMode);if apiMode==""{apiMode=client.APIModeResponses}
 clientOpts:=client.Options{
  APIKey:opts.APIKey,Prompt:opts.Prompt,Mode:mode,Size:opts.Size,Quality:opts.Quality,OutputFormat:opts.OutputFormat,
  MaskB64:opts.MaskB64,Seed:opts.Seed,NegativePrompt:opts.NegativePrompt,Background:opts.Background,
  OutputCompression:opts.OutputCompression,InputFidelity:opts.InputFidelity,ImageStyle:opts.ImageStyle,
  Moderation:opts.Moderation,UserIdentifier:opts.UserIdentifier,BaseURL:opts.BaseURL,TextModelID:opts.TextModelID,
  ImageModelID:opts.ImageModelID,ReasoningEffort:opts.ReasoningEffort,Proxy:client.ProxyConfig{Mode:opts.ProxyMode,URL:opts.ProxyURL},
  APIMode:apiMode,ResponsesTransport:client.ResponsesTransport(strings.TrimSpace(opts.ResponsesTransport)),
  RequestPolicy:client.RequestPolicy(strings.TrimSpace(opts.RequestPolicy)),ImagesNewAPICompat:opts.ImagesNewAPICompat,
  AllowInsecureConnection:opts.AllowInsecureConnection,NoPromptRevision:opts.NoPromptRevision,DisablePreview:opts.DisablePreview,
  AutoRetryEnabled:&opts.AutoRetryEnabled,AutoRetryCount:opts.AutoRetryCount,PartialImages:client.DefaultPartialImages,
 }
 if opts.PartialImages>0{clientOpts.PartialImages=opts.PartialImages}
 var fallbackClientOpts *client.Options
 if p:=opts.FallbackProfile;opts.AutoRetryEnabled&&p!=nil&&strings.TrimSpace(p.APIKey)!=""&&strings.TrimSpace(p.BaseURL)!=""{
  fallback:=clientOpts
  fallback.APIKey=strings.TrimSpace(p.APIKey);fallback.BaseURL=strings.TrimSpace(p.BaseURL)
  fallback.TextModelID=strings.TrimSpace(p.TextModelID);fallback.ImageModelID=strings.TrimSpace(p.ImageModelID)
  fallback.ReasoningEffort=strings.TrimSpace(p.ReasoningEffort);fallback.APIMode=client.APIMode(strings.TrimSpace(p.APIMode))
  if fallback.APIMode==""{fallback.APIMode=client.APIModeResponses}
  fallback.ResponsesTransport=client.ResponsesTransport(strings.TrimSpace(p.ResponsesTransport));fallback.RequestPolicy=client.RequestPolicy(strings.TrimSpace(p.RequestPolicy))
  fallback.ImagesNewAPICompat=p.ImagesNewAPICompat;fallback.AllowInsecureConnection=p.AllowInsecureConnection;fallbackClientOpts=&fallback
 }
 if mode==client.ModeEdit{
  paths,cleanup,prepErr:=prepareUploadSourcePaths(opts.collectPaths());if prepErr!=nil{return generationFailure(prepErr,"")};defer cleanup()
  clientOpts.ImagePaths=paths;if fallbackClientOpts!=nil{fallbackClientOpts.ImagePaths=paths}
  if apiMode==client.APIModeResponses||(fallbackClientOpts!=nil&&fallbackClientOpts.APIMode==client.APIModeResponses){
   urls:=make([]string,0,len(paths));for _,p:=range paths{dataURL,err:=client.ImageFileToDataURL(p);if err!=nil{return generationFailure(fmt.Errorf("加载源图片 %s 失败:%w",filepath.Base(p),err),"")};urls=append(urls,dataURL)}
   clientOpts.ImageDataURLs=urls;if fallbackClientOpts!=nil&&fallbackClientOpts.APIMode==client.APIModeResponses{fallbackClientOpts.ImageDataURLs=urls}
  }
 }
 transport,err:=client.PickTransportWithProxyAndSecurity(clientOpts.Proxy,clientOpts.AllowInsecureConnection);if err!=nil{return generationFailure(err,"")}
 rootDir,err:=s.resolvedOutputDir();if err!=nil{return generationFailure(err,"")}
 imagesDir,thumbsDir,previewsDir,logDir:=imagesSubdir(rootDir),thumbsSubdir(rootDir),previewsSubdir(rootDir),logSubdir(rootDir)
 for _,dir:=range []string{imagesDir,thumbsDir,previewsDir,logDir}{if err:=os.MkdirAll(dir,secureDirMode);err!=nil{return generationFailure(err,"")}}
 // Full reserved ID prevents same-second requests sharing a prefix from
 // overwriting one another's images or raw response logs.
 timestamp:=time.Now().Format("20060102-150405")+"-"+jobID
 logFn:=func(msg string){if ctx.Err()==nil{runtime.EventsEmit(s.ctx,"log:"+jobID,msg)}}
 progressFn:=func(stage string,elapsed int,bytes int64){if ctx.Err()==nil{runtime.EventsEmit(s.ctx,"progress:"+jobID,ProgressPayload{Stage:stage,Elapsed:elapsed,Bytes:bytes})}}
 previewFn:=func(partial client.PartialImage){
  if ctx.Err()!=nil||strings.TrimSpace(partial.ImageB64)==""{return}
  previewName:=fmt.Sprintf("preview-%s-%03d-%d.avif",timestamp,partial.PartialImageIndex,time.Now().UnixNano());previewPath:=filepath.Join(previewsDir,previewName)
  previewW,previewH,previewErr:=createAVIFThumbnailFromBase64(partial.ImageB64,previewPath,mediaPreviewMaxEdge);if previewErr!=nil{logFn(fmt.Sprintf("生成中间预览 AVIF 失败:%v",previewErr));return}
  asset,mediaErr:=s.registerPreviewMedia(previewPath,previewW,previewH);if mediaErr!=nil{logFn(fmt.Sprintf("登记中间预览失败:%v",mediaErr));return}
  runtime.EventsEmit(s.ctx,"preview:"+jobID,PreviewPayload{ImageID:asset.ID,PreviewURL:asset.PreviewURL,PreviewWidth:asset.PreviewWidth,PreviewHeight:asset.PreviewHeight,RevisedPrompt:partial.RevisedPrompt,PartialImageIndex:partial.PartialImageIndex,Mode:string(mode),Prompt:opts.Prompt})
 }
 result,rawPath,err:=client.RequestAndExtractWithRetriesAndPartial(ctx,transport,clientOpts,logDir,timestamp,logFn,progressFn,previewFn)
 if ctx.Err()==nil&&err!=nil&&fallbackClientOpts!=nil&&shouldRouteFallbackAttempt(err,rawPath){
  logFn("主上游自动重试失败，切换到备用上游再试一次...")
  fallbackTransport,transportErr:=client.PickTransportWithProxyAndSecurity(fallbackClientOpts.Proxy,fallbackClientOpts.AllowInsecureConnection);if transportErr!=nil{return generationFailure(transportErr,"")}
  result,rawPath,err=client.RequestAndExtractWithRetriesAndPartial(ctx,fallbackTransport,*fallbackClientOpts,logDir,timestamp+"-fallback",logFn,progressFn,previewFn)
 }
 if err!=nil{return generationFailure(err,rawPath)};if ctx.Err()!=nil{return generationFailure(ctx.Err(),rawPath)}
 imageName:=buildImageName(mode,opts.Prompt,timestamp,opts.OutputFormat);savedPath:=filepath.Join(imagesDir,imageName)
 absSaved,werr:=writeBase64PNG(result.ImageB64,savedPath);if werr!=nil{return generationFailure(fmt.Errorf("保存结果图片失败:%w",werr),rawPath)};savedPath=absSaved
 thumbName:=strings.TrimSuffix(filepath.Base(imageName),filepath.Ext(imageName))+".avif";thumbPath:=filepath.Join(thumbsDir,thumbName)
 thumbW,thumbH,thumbErr:=createAVIFThumbnail(savedPath,thumbPath,mediaThumbMaxEdge);if thumbErr!=nil{return generationFailure(fmt.Errorf("生成 AVIF 缩略图失败:%w",thumbErr),rawPath)}
 asset,mediaErr:=s.registerGeneratedMedia(savedPath,thumbPath,thumbW,thumbH);if mediaErr!=nil{return generationFailure(fmt.Errorf("登记本地图片失败:%w",mediaErr),rawPath)};absRaw,_:=filepath.Abs(rawPath)
 return json.Marshal(ResultPayload{RevisedPrompt:result.RevisedPrompt,SourceEvent:result.SourceEvent,ImageID:asset.ID,SavedPath:savedPath,ThumbPath:asset.ThumbPath,PreviewURL:asset.PreviewURL,FullURL:asset.FullURL,PreviewWidth:asset.PreviewWidth,PreviewHeight:asset.PreviewHeight,RawPath:absRaw,Mode:string(mode),Prompt:opts.Prompt})
}
