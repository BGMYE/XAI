package client

// Submission, polling and media transfer are separate operations. A failed
// download must never cause another paid creation request.
import (
 "bytes"
 "context"
 "encoding/base64"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "net"
 "net/http"
 "os"
 "path/filepath"
 "strconv"
 "strings"
 "time"
)

type VideoJobOptions struct {
 BaseURL string
 APIKey string
 Protocol string // openai-compatible (multipart) or xai (JSON)
 Model string
 Prompt string
 Seconds int
 Size string
 AspectRatio string
 Resolution string
 Reference []byte
 ReferenceName string
 HTTPClient *http.Client
}
type VideoJob struct {
 ID string `json:"id"`
 Status VideoStatus `json:"status"`
 URL string `json:"url,omitempty"`
 B64JSON string `json:"b64_json,omitempty"`
 Error string `json:"error,omitempty"`
}
type VideoAPIError struct { StatusCode int; RetryAfter time.Duration; Message string }
func(e *VideoAPIError)Error()string{return fmt.Sprintf("video API HTTP %d: %s",e.StatusCode,e.Message)}
func VideoPollRetryDelay(err error,attempt int)(time.Duration,bool){
 if attempt<0||attempt>=5{return 0,false}
 var api *VideoAPIError
 if errors.As(err,&api){
  if api.StatusCode!=429&&api.StatusCode<500{return 0,false}
  if api.RetryAfter>0{return min(api.RetryAfter,60*time.Second),true}
 }else{var netErr net.Error;if !errors.As(err,&netErr){return 0,false}}
 return time.Duration(1<<min(attempt+1,5))*time.Second,true
}
func ValidateVideoJobOptions(o VideoJobOptions)(VideoJobOptions,error){
 var err error
 o.BaseURL,err=ValidateBaseURL(o.BaseURL);if err!=nil{return o,err}
 o.APIKey,o.Model=strings.TrimSpace(o.APIKey),strings.TrimSpace(o.Model)
 if o.APIKey==""||o.Model==""||strings.TrimSpace(o.Prompt)==""{return o,errors.New("请配置 API Key、视频模型并输入提示词")}
 if len(o.Prompt)>32000||o.Seconds<1||o.Seconds>60||len(o.Reference)>20*1024*1024{return o,errors.New("视频参数超出限制")}
 if o.Protocol==""{o.Protocol="openai-compatible"}
 switch o.Protocol{
 case "openai-compatible":
  if o.Size!=""{var w,h int;if n,_:=fmt.Sscanf(o.Size,"%dx%d",&w,&h);n!=2||w<1||h<1||w>8192||h>8192||fmt.Sprintf("%dx%d",w,h)!=o.Size{return o,errors.New("视频尺寸格式应为宽x高")}}
 case "xai":
  if o.Seconds>15{return o,errors.New("xAI 视频时长必须为 1–15 秒")}
  switch o.AspectRatio{case "","1:1","16:9","9:16","4:3","3:4","3:2","2:3":default:return o,errors.New("unsupported video aspect ratio")}
  switch o.Resolution{case "","480p","720p","1080p":default:return o,errors.New("unsupported video resolution")}
 default:return o,errors.New("unsupported video protocol")
 }
 return o,nil
}
func CreateVideoJob(ctx context.Context,o VideoJobOptions)(VideoJob,error){
 o,err:=ValidateVideoJobOptions(o);if err!=nil{return VideoJob{},err}
 var body io.Reader;var ct string;path:="/v1/videos"
 if o.Protocol=="xai"{
  path="/v1/videos/generations"
  payload:=map[string]any{"model":o.Model,"prompt":o.Prompt,"duration":o.Seconds}
  if o.AspectRatio!=""{payload["aspect_ratio"]=o.AspectRatio};if o.Resolution!=""{payload["resolution"]=o.Resolution}
  if len(o.Reference)>0{payload["image"]=map[string]string{"url":"data:"+http.DetectContentType(o.Reference)+";base64,"+base64.StdEncoding.EncodeToString(o.Reference)}}
  data,err:=json.Marshal(payload);if err!=nil{return VideoJob{},err};body,ct=bytes.NewReader(data),"application/json"
 }else{
  body,ct,err=buildVideoMultipart(VideoOptions{VideoModelID:o.Model,Prompt:o.Prompt,Seconds:o.Seconds,Size:o.Size,InputReference:o.Reference,InputReferenceName:o.ReferenceName});if err!=nil{return VideoJob{},err}
 }
 endpoint,err:=videoEndpoint(o.BaseURL,path,"");if err!=nil{return VideoJob{},err}
 return requestVideoJob(ctx,o,http.MethodPost,endpoint,ct,body,"")
}
func PollVideoJob(ctx context.Context,o VideoJobOptions,id string)(VideoJob,error){
 base,err:=ValidateBaseURL(o.BaseURL);if err!=nil{return VideoJob{},err};o.BaseURL=base
 if strings.TrimSpace(o.APIKey)==""||!validRemoteVideoID(id){return VideoJob{},errors.New("invalid video polling credentials or ID")}
 endpoint,err:=videoEndpoint(base,"/v1/videos",id);if err!=nil{return VideoJob{},err}
 return requestVideoJob(ctx,o,http.MethodGet,endpoint,"",nil,id)
}
func validRemoteVideoID(id string)bool{if id==""||len(id)>256||id=="."||id==".."{return false};return !strings.ContainsAny(id,"/\\?#\r\n\t ")}
func requestVideoJob(ctx context.Context,o VideoJobOptions,method,endpoint,ct string,body io.Reader,id string)(VideoJob,error){
 ctx,cancel:=context.WithTimeout(ctx,90*time.Second);defer cancel()
 req,err:=http.NewRequestWithContext(ctx,method,endpoint,body);if err!=nil{return VideoJob{},err}
 req.Header.Set("Authorization","Bearer "+o.APIKey);req.Header.Set("Accept","application/json");req.Header.Set("User-Agent",UserAgent());if ct!=""{req.Header.Set("Content-Type",ct)}
 resp,err:=videoHTTPClient(o.HTTPClient).Do(req);if err!=nil{return VideoJob{},err};defer resp.Body.Close()
 data,err:=io.ReadAll(io.LimitReader(resp.Body,MaxVideoResponseBytes+1));if err!=nil{return VideoJob{},err};if len(data)>MaxVideoResponseBytes{return VideoJob{},errors.New("video metadata response exceeds limit")}
 if resp.StatusCode<200||resp.StatusCode>=300{
  var parsed struct{Error json.RawMessage `json:"error"`};_ = json.Unmarshal(data,&parsed);retry:=time.Duration(0)
  if seconds,e:=strconv.Atoi(resp.Header.Get("Retry-After"));e==nil&&seconds>0&&seconds<=3600{retry=time.Duration(seconds)*time.Second}else if at,e:=http.ParseTime(resp.Header.Get("Retry-After"));e==nil{retry=time.Until(at)}
  return VideoJob{},&VideoAPIError{resp.StatusCode,retry,videoErrorText(parsed.Error,data)}
 }
 return decodeVideoJob(data,id,o.Protocol,method==http.MethodPost)
}
func decodeVideoJob(data []byte,id,protocol string,creating bool)(VideoJob,error){
 var p struct{
  ID string `json:"id"`;RequestID string `json:"request_id"`;Status string `json:"status"`
  URL string `json:"url"`;VideoURL string `json:"video_url"`;B64 string `json:"b64_json"`;Error json.RawMessage `json:"error"`
  Video struct{URL string `json:"url"`;RespectModeration *bool `json:"respect_moderation"`} `json:"video"`
  Data []struct{URL string `json:"url"`;B64 string `json:"b64_json"`} `json:"data"`
 }
 if err:=json.Unmarshal(data,&p);err!=nil{return VideoJob{},fmt.Errorf("decode video metadata: %w",err)}
 if !creating&&id!=""&&((p.ID!=""&&p.ID!=id)||(p.RequestID!=""&&p.RequestID!=id)){return VideoJob{},errors.New("video polling ID mismatch")}
 if p.ID!=""{id=p.ID};if p.RequestID!=""{id=p.RequestID};if !validRemoteVideoID(id){return VideoJob{},errors.New("video response missing valid task ID")}
 r:=VideoJob{ID:id,URL:p.URL,B64JSON:p.B64};if r.URL==""{r.URL=p.VideoURL};if r.URL==""{r.URL=p.Video.URL}
 if len(p.Data)>0{if r.URL==""{r.URL=p.Data[0].URL};if r.B64JSON==""{r.B64JSON=p.Data[0].B64}}
 switch strings.ToLower(strings.TrimSpace(p.Status)){
 case "queued":r.Status=VideoStatusQueued
 case "pending","processing","running","in_progress":r.Status=VideoStatusInProgress
 case "done","succeeded","completed":r.Status=VideoStatusCompleted
 case "failed","expired":r.Status=VideoStatusFailed
 case "cancelled","canceled":r.Status=VideoStatusCancelled
 case "":if creating&&protocol=="xai"&&p.RequestID!=""{r.Status=VideoStatusQueued}else{return r,errors.New("video response missing status")}
 default:return r,fmt.Errorf("unrecognized video status: %.80s",p.Status)
 }
 if len(p.Error)>0&&string(p.Error)!="null"{r.Error=videoErrorText(p.Error,nil)}
 if p.Video.RespectModeration!=nil&&!*p.Video.RespectModeration{r.Status=VideoStatusFailed;r.Error="视频未通过上游审核"}
 if r.Status==VideoStatusCompleted&&protocol=="xai"&&r.URL==""&&r.B64JSON==""{return r,errors.New("completed xAI video is missing media")}
 return r,nil
}

// SaveVideoJobMedia streams into a private temporary file. CDN requests never
// receive the API key; only the same-origin /content request is authenticated.
func SaveVideoJobMedia(ctx context.Context,o VideoJobOptions,r VideoJob,target string,limit int64)error{
 if r.Status!=VideoStatusCompleted{return errors.New("video is not complete")};if limit<=0||limit>1024*1024*1024{limit=512*1024*1024}
 var reader io.Reader;var response *http.Response
 if r.B64JSON!=""{reader=base64.NewDecoder(base64.StdEncoding,strings.NewReader(r.B64JSON))}else{
  var err error
  if r.URL!=""{response,err=openVideoMediaStream(ctx,r.URL,o.BaseURL)}else{
   if o.Protocol=="xai"{return errors.New("missing video media URL")};base,e:=ValidateBaseURL(o.BaseURL);if e!=nil{return e};if !validRemoteVideoID(r.ID){return errors.New("invalid video ID")}
   endpoint,e:=videoEndpoint(base,"/v1/videos",r.ID);if e!=nil{return e};req,e:=http.NewRequestWithContext(ctx,http.MethodGet,endpoint+"/content",nil);if e!=nil{return e}
   req.Header.Set("Authorization","Bearer "+o.APIKey);response,err=videoHTTPClient(o.HTTPClient).Do(req)
   if err==nil&&response.StatusCode>=300&&response.StatusCode<400{location,e:=response.Location();response.Body.Close();if e!=nil{return e};response,err=openVideoMediaStream(ctx,location.String(),base)}
  }
  if err!=nil{return err};defer response.Body.Close()
  if response.StatusCode<200||response.StatusCode>=300{return fmt.Errorf("video download HTTP %d",response.StatusCode)}
  if response.ContentLength>limit{return errors.New("video exceeds configured download limit")}
  contentType:=strings.ToLower(response.Header.Get("Content-Type"));if strings.HasPrefix(contentType,"text/")||strings.Contains(contentType,"json"){return errors.New("upstream returned text instead of video")};reader=response.Body
 }
 if err:=os.MkdirAll(filepath.Dir(target),0700);err!=nil{return err};file,err:=os.CreateTemp(filepath.Dir(target),".video-*");if err!=nil{return err};defer os.Remove(file.Name())
 n,err:=io.Copy(file,io.LimitReader(reader,limit+1));if err==nil&&n==0{err=errors.New("empty video download")};if err==nil&&n>limit{err=errors.New("video exceeds configured download limit")};if err==nil{err=file.Sync()};closeErr:=file.Close()
 if err!=nil{return err};if closeErr!=nil{return closeErr};return os.Rename(file.Name(),target)
}
func openVideoMediaStream(ctx context.Context,raw,base string)(*http.Response,error){
 if _,err:=validateVideoMediaURLForBase(raw,base);err!=nil{return nil,err}
 transport:=&http.Transport{Proxy:nil,DisableCompression:true,DisableKeepAlives:true,DialContext:func(ctx context.Context,network,address string)(net.Conn,error){
  host,port,err:=net.SplitHostPort(address);if err!=nil{return nil,err};ip,err:=resolvePinnedVideoIP(ctx,net.DefaultResolver,host,isLoopbackBaseURL(base));if err!=nil{return nil,err};return (&net.Dialer{Timeout:30*time.Second}).DialContext(ctx,network,net.JoinHostPort(ip.String(),port))
 }}
 c:=&http.Client{Transport:transport,Timeout:8*time.Minute,CheckRedirect:func(req *http.Request,via []*http.Request)error{if len(via)>=5{return errors.New("video redirect limit reached")};_,err:=validateVideoMediaURLForBase(req.URL.String(),base);return err}}
 req,err:=http.NewRequestWithContext(ctx,http.MethodGet,raw,nil);if err!=nil{return nil,err};req.Header.Set("User-Agent",UserAgent());req.Header.Set("Accept","video/*,application/octet-stream");return c.Do(req)
}
