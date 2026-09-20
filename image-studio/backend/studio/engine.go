package studio

import (
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "sort"
 "strings"
 "sync"
 "time"
)

type SecretStore interface {Get(string)(string,error);Set(string,string)error;Delete(string)error}
type Output struct {Data []byte;MIME string}
type Checkpoint func(remoteID string,progress int)error
type Runner interface {Run(context.Context,Job,string,*Output,Checkpoint)(Output,error)}
type Options struct {Workers int;Runner Runner;PollInterval time.Duration}
type Engine struct {mu sync.Mutex;cond *sync.Cond;repo repository;db document;secrets SecretStore;runner Runner;ctx context.Context;stop context.CancelFunc;wg sync.WaitGroup;closed bool;fatal error;cancels map[string]context.CancelFunc}

func Open(root string,secrets SecretStore,opts Options)(*Engine,error){
 if secrets==nil{return nil,errors.New("缺少安全凭据存储")}
 n:=opts.Workers;if n==0{n=2};if n<1||n>8{return nil,errors.New("worker 数必须为 1–8")}
 repo:=repository{root};d,err:=repo.read();if err!=nil{return nil,err}
 // A crash must NEVER cause an automatic replay of a possibly charged POST.
 for id,j:=range d.Jobs{switch j.State{case "running":if j.RemoteID!=""{j.State="paused";j.Error="应用中断；可恢复轮询，不重新提交"}else{j.State="uncertain";j.Error="提交结果未知；请在上游核对，系统不会自动重发收费请求"};case "queued":j.State="paused";j.Error="待执行任务已暂停，请手动恢复";default:continue};j.UpdatedAt=now();d.Jobs[id]=j}
 if err=repo.write(d);err!=nil{return nil,err}
 ctx,cancel:=context.WithCancel(context.Background());e:=&Engine{repo:repo,db:d,secrets:secrets,runner:opts.Runner,ctx:ctx,stop:cancel,cancels:map[string]context.CancelFunc{}}
 if e.runner==nil{e.runner=&HTTPProvider{PollInterval:opts.PollInterval}};e.cond=sync.NewCond(&e.mu)
 for i:=0;i<n;i++{e.wg.Add(1);go e.worker()};return e,nil
}
func(e *Engine)Close(){e.mu.Lock();if !e.closed{e.closed=true;e.stop();e.cond.Broadcast()};e.mu.Unlock();e.wg.Wait()}
// mutate is called under e.mu: publish only after durable storage succeeds.
func(e *Engine)mutate(fn func(*document)error)error{next:=cloneDocument(e.db);if err:=fn(&next);err!=nil{return err};if err:=e.repo.write(next);err!=nil{return fmt.Errorf("保存失败，原数据保留：%w",err)};e.db=next;return nil}
func(e *Engine)ready()error{if e.closed{return errors.New("工作室已关闭")};return e.fatal}
func(e *Engine)Snapshot()(Snapshot,error){
 e.mu.Lock();defer e.mu.Unlock();if e.fatal!=nil{return Snapshot{},e.fatal};d:=cloneDocument(e.db);s:=Snapshot{[]Profile{},[]Project{},[]Asset{},[]Job{}}
 for _,v:=range d.Profiles{s.Profiles=append(s.Profiles,v)};for _,v:=range d.Projects{s.Projects=append(s.Projects,v)};for _,v:=range d.Assets{s.Assets=append(s.Assets,v)};for _,v:=range d.Jobs{s.Jobs=append(s.Jobs,v)}
 sort.Slice(s.Profiles,func(i,j int)bool{return s.Profiles[i].Name<s.Profiles[j].Name});sort.Slice(s.Projects,func(i,j int)bool{return s.Projects[i].UpdatedAt>s.Projects[j].UpdatedAt});sort.Slice(s.Assets,func(i,j int)bool{return s.Assets[i].CreatedAt>s.Assets[j].CreatedAt});sort.Slice(s.Jobs,func(i,j int)bool{return s.Jobs[i].CreatedAt>s.Jobs[j].CreatedAt});return s,nil
}
func(e *Engine)SaveProject(p Project)(Project,error){
 if _,err:=p.Order();err!=nil{return Project{},err};e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return Project{},err}
 err:=e.mutate(func(d *document)error{old,exists:=d.Projects[p.ID];if (exists&&old.Revision!=p.Revision)||(!exists&&p.Revision!=0){return ErrConflict}
  for _,n:=range p.Nodes{if n.AssetID!=""{if _,ok:=d.Assets[n.AssetID];!ok{return errors.New("引用的素材不存在，请先导入素材")}}}
  if !exists&&len(d.Projects)>=1000{return errors.New("画布数量达到 1000，请先归档")}
  p.Revision++;p.UpdatedAt=now();if p.Nodes==nil{p.Nodes=[]Node{}};if p.Edges==nil{p.Edges=[]Edge{}};d.Projects[p.ID]=p;return nil});return p,err
}
func fingerprint(r Request,deps []string)string{b,_:=json.Marshal(struct{R Request;D []string}{r,deps});sum:=sha256.Sum256(b);return hex.EncodeToString(sum[:])}
func(e *Engine)buildJob(d *document,r Request,deps []string)(Job,error){
 if old,ok:=d.Jobs[r.ID];ok{if old.Fingerprint!=fingerprint(r,deps){return Job{},errors.New("幂等标识已用于不同的请求")};return old,nil}
 p,ok:=d.Profiles[r.ProfileID];if !ok{return Job{},errors.New("上游不存在")};if err:=r.Validate(p);err!=nil{return Job{},err}
 project,ok:=d.Projects[r.ProjectID];if !ok{return Job{},errors.New("请先保存目标画布")}
 if len(project.Nodes)>=2000{return Job{},errors.New("画布接近容量上限，请新建画布")}
 if r.NodeID!=""{found:=false;for _,n:=range project.Nodes{if n.ID==r.NodeID{found=true;if n.Kind!=r.Kind{return Job{},errors.New("目标节点类型不匹配")}}};if !found{return Job{},errors.New("目标节点不存在")}}
 if r.ReferenceAssetID!=""{a,ok:=d.Assets[r.ReferenceAssetID];if !ok||a.Kind!="image"{return Job{},errors.New("参考素材必须是已导入的图片")};if a.Bytes>20*1024*1024{return Job{},errors.New("参考图片最大 20 MB")}}
 if len(deps)>1{return Job{},errors.New("当前生成适配器只接受一个上游图片结果")}
 for _,id:=range deps{j,ok:=d.Jobs[id];if !ok||j.Request.Kind!="image"{return Job{},errors.New("仅支持从图片生成节点继续生成；视频不能作为参考图片")}}
 if len(deps)>0&&r.ReferenceAssetID!=""{return Job{},errors.New("当前仅支持一张参考图，请移除额外图片连线")}
 active:=0;for _,j:=range d.Jobs{if !terminal(j.State){active++}};if active>=128{return Job{},errors.New("待处理任务达到 128 个，请稍后提交")};if len(d.Jobs)>=10000{return Job{},errors.New("任务历史达到上限，请归档数据库后继续")}
 j:=Job{ID:r.ID,Request:r,Profile:p,Fingerprint:fingerprint(r,deps),State:"queued",DependsOn:append([]string{},deps...),CreatedAt:now(),UpdatedAt:now()};d.Jobs[j.ID]=j;return j,nil
}
func(e *Engine)Submit(r Request)(Job,error){e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return Job{},err};var j Job;err:=e.mutate(func(d *document)error{var err error;j,err=e.buildJob(d,r,nil);return err});if err==nil{e.cond.Broadcast()};return j,err}

// The graph expands transactionally. Invalid nodes cannot partly submit a paid
// workflow. Output-asset provenance edges are not executable input commands.
func(e *Engine)RunWorkflow(projectID,profileID,runID string)([]Job,error){
 if err:=checkID(runID);err!=nil{return nil,err};e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return nil,err}
 p,ok:=e.db.Projects[projectID];if !ok{return nil,errors.New("画布不存在")};order,err:=p.Order();if err!=nil{return nil,err}
 nodes:=map[string]Node{};for _,n:=range p.Nodes{nodes[n.ID]=n};ids:=map[string]string{};jobs:=[]Job{}
 err=e.mutate(func(d *document)error{for _,id:=range order{n:=nodes[id];if n.Kind!="image"&&n.Kind!="video"{continue}
  r:=Request{ID:runID+"-"+id,ProfileID:profileID,ProjectID:projectID,NodeID:id,Kind:n.Kind,Parameters:n.Parameters};texts:=[]string{};deps:=[]string{}
  for _,edge:=range p.Edges{if edge.To!=id{continue};source:=nodes[edge.From];switch source.Kind{
   case "prompt","note":if strings.TrimSpace(source.Text)!=""{texts=append(texts,source.Text)}
   case "asset":if source.AssetID==""{return errors.New("素材节点尚未选择文件，请先绑定本地图片")};if r.ReferenceAssetID!=""{return errors.New("一个节点仅支持一张参考图片")};r.ReferenceAssetID=source.AssetID
   case "image","video":deps=append(deps,ids[source.ID])}}
  if strings.TrimSpace(n.Text)!=""{texts=append(texts,n.Text)};r.Prompt=strings.Join(texts,"\n\n");j,err:=e.buildJob(d,r,deps);if err!=nil{return fmt.Errorf("节点 %s：%w",n.Title,err)};ids[id]=j.ID;jobs=append(jobs,j)}
  if len(jobs)==0{return errors.New("画布没有可执行的图片或视频生成节点")};return nil})
 if err==nil{e.cond.Broadcast()};return jobs,err
}
func(e *Engine)Cancel(id string)error{
 e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return err};j,ok:=e.db.Jobs[id];if !ok{return errors.New("任务不存在")};if terminal(j.State){return nil}
 err:=e.mutate(func(d *document)error{j.State="cancelled";j.Error="已停止本地任务；上游可能仍执行和计费";j.UpdatedAt=now();d.Jobs[id]=j;return nil});if err==nil{if cancel:=e.cancels[id];cancel!=nil{cancel()};e.cond.Broadcast()};return err
}
func(e *Engine)Resume(id string)error{
 e.mu.Lock();defer e.mu.Unlock();if err:=e.ready();err!=nil{return err};j,ok:=e.db.Jobs[id];if !ok{return errors.New("任务不存在")};if j.State!="paused"{return errors.New("只能恢复已暂停任务；结果未知的提交不会自动重发")}
 err:=e.mutate(func(d *document)error{j.State="queued";j.Error="";j.UpdatedAt=now();d.Jobs[id]=j;return nil});if err==nil{e.cond.Broadcast()};return err
}
// claim holds the engine lock: durable claim and dependency resolution are one
// transaction, so concurrent workers cannot double-submit the same task.
func(e *Engine)claim()(Job,bool,error){
 ids:=[]string{};for id,j:=range e.db.Jobs{if j.State=="queued"{ids=append(ids,id)}};sort.Slice(ids,func(i,j int)bool{return e.db.Jobs[ids[i]].CreatedAt<e.db.Jobs[ids[j]].CreatedAt})
 for _,id:=range ids{j:=e.db.Jobs[id];ready:=true;blocked:=false
  for _,dep:=range j.DependsOn{p,exists:=e.db.Jobs[dep];if !exists||(terminal(p.State)&&p.State!="succeeded"){blocked=true};if p.State!="succeeded"{ready=false}}
  if blocked{if err:=e.mutate(func(d *document)error{j.State="failed";j.Error="上游依赖未成功，未发出本节点请求";j.UpdatedAt=now();d.Jobs[id]=j;return nil});err!=nil{return Job{},false,err};e.cond.Broadcast();continue}
  if !ready{continue}
  err:=e.mutate(func(d *document)error{for _,dep:=range j.DependsOn{j.Request.ReferenceAssetID=d.Jobs[dep].ResultAssetID};j.State="running";j.UpdatedAt=now();d.Jobs[id]=j;return nil});return j,err==nil,err
 };return Job{},false,nil
}
func(e *Engine)worker(){
 defer e.wg.Done()
 for{e.mu.Lock();var job Job;var ctx context.Context;var cancel context.CancelFunc
  for{if e.closed||e.fatal!=nil{e.mu.Unlock();return};j,ok,err:=e.claim();if err!=nil{e.fatal=err;e.cond.Broadcast();e.mu.Unlock();return};if ok{job=j;ctx,cancel=context.WithTimeout(e.ctx,20*time.Minute);e.cancels[j.ID]=cancel;break};e.cond.Wait()}
  e.mu.Unlock();output,err:=e.run(ctx,job);cancel();e.mu.Lock();delete(e.cancels,job.ID);current:=e.db.Jobs[job.ID]
  if current.State=="running"{
   if err!=nil{state:="failed";message:=err.Error();var uncertain *UncertainError;var resumable *ResumeError
    if errors.As(err,&uncertain){state="uncertain"}
    if current.RemoteID!=""&&errors.As(err,&resumable){state="paused"}
    if current.RemoteID!=""&&(errors.Is(err,context.DeadlineExceeded)||e.closed){state="paused";message="等待中断，可恢复轮询，不重新提交"}
    if e.closed&&current.RemoteID==""{state="uncertain";message="应用在提交期间关闭，请先核对上游请求"}
    err=e.mutate(func(d *document)error{current.State=state;current.Error=message;current.UpdatedAt=now();d.Jobs[job.ID]=current;return nil})
   }else{err=e.finish(current,output)}
   if err!=nil{e.fatal=fmt.Errorf("任务状态无法落盘，请重启并检查磁盘空间：%w",err)}
  };e.cond.Broadcast();e.mu.Unlock()
 }
}
func(e *Engine)run(ctx context.Context,j Job)(out Output,runErr error){
 defer func(){if recover()!=nil{out=Output{};runErr=&UncertainError{}}}()
 slot:=j.Profile.secretSlot();if slot==""{slot=j.Request.ProfileID};key,err:=e.secrets.Get(slot);if err!=nil||key==""{return Output{},errors.New("无法从系统凭据存储读取 API Key，请重新保存")}
 var ref *Output
 if j.Request.ReferenceAssetID!=""{e.mu.Lock();a,ok:=e.db.Assets[j.Request.ReferenceAssetID];e.mu.Unlock();if !ok||a.Kind!="image"{return Output{},errors.New("参考图片不存在")};if a.Bytes>20*1024*1024{return Output{},errors.New("参考图片最大 20 MB")};b,err:=os.ReadFile(filepath.Join(e.repo.root,"media",a.FileName));if err!=nil{return Output{},errors.New("参考图片文件不可读")};ref=&Output{b,a.MIME}}
 result,err:=e.runner.Run(ctx,j,key,ref,func(id string,progress int)error{
  if id!=""&&!validRemoteID(id){return errors.New("上游返回无效任务 ID")};e.mu.Lock();defer e.mu.Unlock();current:=e.db.Jobs[j.ID]
  if current.State!="running"{return context.Canceled}
  progress=max(0,min(progress,99));if current.RemoteID==id&&current.Progress==progress{return nil}
  return e.mutate(func(d *document)error{current.RemoteID=id;current.Progress=progress;current.UpdatedAt=now();d.Jobs[j.ID]=current;return nil})})
 if err!=nil{var uncertain *UncertainError;var resumable *ResumeError;if errors.As(err,&uncertain)||errors.As(err,&resumable)||errors.Is(err,context.Canceled)||errors.Is(err,context.DeadlineExceeded){return Output{},err};return Output{},errors.New(strings.ReplaceAll(err.Error(),key,"[REDACTED]"))};return result,nil
}
