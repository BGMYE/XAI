// Package taskqueue owns generation lifecycles independently of the Wails host.
// Credentials live only in Runner closures, never in the persisted Record.
package taskqueue

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "sort"
 "sync"
 "time"
)

type Status string
const (
 Queued Status = "queued"
 Running Status = "running"
 Succeeded Status = "succeeded"
 Failed Status = "failed"
 Cancelled Status = "cancelled"
 Interrupted Status = "interrupted"
)
func Terminal(s Status) bool { return s != Queued && s != Running }
type Record struct {
 ID string `json:"id"`
 Kind string `json:"kind"`
 Queue string `json:"queue"`
 WorkspaceID string `json:"workspaceId,omitempty"`
 ProfileID string `json:"profileId,omitempty"`
 ModelID string `json:"modelId,omitempty"`
 Provider string `json:"provider,omitempty"`
 BaseURL string `json:"baseURL,omitempty"`
 Label string `json:"label,omitempty"`
 RemoteID string `json:"remoteId,omitempty"`
 Status Status `json:"status"`
 Stage string `json:"stage,omitempty"`
 Error string `json:"error,omitempty"`
 CreatedAt int64 `json:"createdAt"`
 UpdatedAt int64 `json:"updatedAt"`
 Revision uint64 `json:"revision"`
 Result json.RawMessage `json:"result,omitempty"`
}
type Repository interface { Load() ([]Record,error); Save([]Record) error }
type Reporter func(remoteID,stage string) error
type Runner func(context.Context,Reporter)(json.RawMessage,error)
type entry struct { record Record; run Runner; limit int; cancel context.CancelFunc }
type Manager struct {
 mu sync.Mutex
 ctx context.Context
 repo Repository
 entries map[string]*entry
 pending []string
 active map[string]int
 activeTotal int
 closed bool
 wg sync.WaitGroup
 onChange func(Record)
}
func clone(r Record)Record{r.Result=append(json.RawMessage(nil),r.Result...);return r}
func touch(r *Record){r.Revision++;r.UpdatedAt=time.Now().UnixMilli()}
func New(ctx context.Context,repo Repository,onChange func(Record))(*Manager,error){
 if ctx==nil{ctx=context.Background()}
 records,err:=repo.Load();if err!=nil{return nil,err}
 m:=&Manager{ctx:ctx,repo:repo,entries:map[string]*entry{},active:map[string]int{},onChange:onChange}
 for _,r:=range records{
  if !ValidID(r.ID){return nil,errors.New("invalid persisted task id")}
  if !Terminal(r.Status){r.Status,r.Stage=Interrupted,"应用已退出；不会自动重新提交生成请求";touch(&r)}
  m.entries[r.ID]=&entry{record:clone(r)}
 }
 if err=m.persistLocked();err!=nil{return nil,err};return m,nil
}
func(m *Manager)recordsLocked()[]Record{
 records:=make([]Record,0,len(m.entries));for _,e:=range m.entries{records=append(records,clone(e.record))}
 sort.Slice(records,func(i,j int)bool{if records[i].CreatedAt==records[j].CreatedAt{return records[i].ID<records[j].ID};return records[i].CreatedAt>records[j].CreatedAt});return records
}
func(m *Manager)persistLocked()error{return m.repo.Save(m.recordsLocked())}
func(m *Manager)notify(r Record){if m.onChange!=nil{m.onChange(clone(r))}}
func(m *Manager)List()[]Record{m.mu.Lock();defer m.mu.Unlock();return m.recordsLocked()}
func(m *Manager)Get(id string)(Record,error){m.mu.Lock();defer m.mu.Unlock();if e:=m.entries[id];e!=nil{return clone(e.record),nil};return Record{},errors.New("task not found")}
// Submit reserves the ID durably before calling upstream. Legacy image callers
// retain reject-when-busy semantics; videos use a bounded FIFO queue.
func(m *Manager)Submit(r Record,limit int,rejectBusy bool,run Runner)(Record,error){
 if !ValidID(r.ID)||r.Kind==""||r.Queue==""||run==nil{return Record{},errors.New("invalid task")}
 if limit<=0{limit=32};if limit>32{limit=32}
 m.mu.Lock()
 if m.closed{m.mu.Unlock();return Record{},errors.New("task service is stopping")}
 if _,ok:=m.entries[r.ID];ok{m.mu.Unlock();return Record{},errors.New("task id already exists; duplicate generation rejected")}
 if len(m.pending)>=256{m.mu.Unlock();return Record{},errors.New("task queue is full")}
 if rejectBusy&&m.active[r.Queue]>=limit{m.mu.Unlock();return Record{},fmt.Errorf("并发限制 %d 已达到",limit)}
 r.Status,r.CreatedAt,r.UpdatedAt,r.Revision=Queued,time.Now().UnixMilli(),time.Now().UnixMilli(),1
 r.Result,r.Error,r.RemoteID=nil,"",""
 m.entries[r.ID]=&entry{record:clone(r),run:run,limit:limit}
 if err:=m.persistLocked();err!=nil{delete(m.entries,r.ID);m.mu.Unlock();return Record{},err}
 m.pending=append(m.pending,r.ID);m.startLocked();r=clone(m.entries[r.ID].record);m.mu.Unlock();return r,nil
}
// Resume reuses a persisted upstream ID. The supplied Runner must poll only:
// restart must never silently issue another paid creation request.
func(m *Manager)Resume(id string,run Runner)(Record,error){
 m.mu.Lock();e:=m.entries[id]
 if m.closed||e==nil||e.record.RemoteID==""||run==nil||!Terminal(e.record.Status)||e.record.Status==Succeeded||e.cancel!=nil{m.mu.Unlock();return Record{},errors.New("task is not resumable")}
 if len(m.pending)>=256{m.mu.Unlock();return Record{},errors.New("task queue is full")}
 old:=clone(e.record);e.record.Status,e.record.Error,e.record.Result=Queued,"",nil;touch(&e.record);e.run,e.limit=run,2
 if err:=m.persistLocked();err!=nil{e.record=old;e.run=nil;m.mu.Unlock();return Record{},err}
 m.pending=append(m.pending,id);m.startLocked();r:=clone(e.record);m.mu.Unlock();return r,nil
}
func(m *Manager)startLocked(){
 if m.closed{return};waiting:=m.pending[:0]
 for _,id:=range m.pending{
  e:=m.entries[id];if e==nil||e.record.Status!=Queued{continue};limit:=e.limit
  for _,other:=range m.entries{if other.cancel!=nil&&other.record.Queue==e.record.Queue&&other.limit<limit{limit=other.limit}}
  if m.activeTotal>=32||m.active[e.record.Queue]>=limit{waiting=append(waiting,id);continue}
  e.record.Status,e.record.Stage=Running,"开始处理";touch(&e.record)
  if err:=m.persistLocked();err!=nil{e.record.Status,e.record.Error=Failed,"无法持久化任务状态；请求未发送";r:=clone(e.record);go m.notify(r);e.run=nil;continue}
  ctx,cancel:=context.WithCancel(m.ctx);e.cancel=cancel;m.active[e.record.Queue]++;m.activeTotal++;m.wg.Add(1);go m.execute(ctx,id,e.run)
 }
 m.pending=waiting
}
func(m *Manager)execute(ctx context.Context,id string,run Runner){
 defer m.wg.Done();var result json.RawMessage;var err error
 func(){
  defer func(){if recover()!=nil{err=errors.New("generation worker panicked")}}()
  result,err=run(ctx,func(remoteID,stage string)error{
   m.mu.Lock();defer m.mu.Unlock();e:=m.entries[id]
   // A paid create request can succeed while local cancellation is racing its
   // response. Preserve the remote ID even then, without reviving the task.
   if remoteID!=""{e.record.RemoteID=remoteID;touch(&e.record)}
   if e.record.Status!=Running{if err:=m.persistLocked();err!=nil{return err};return context.Canceled}
   e.record.Stage=stage;touch(&e.record)
   // Preserve received remote IDs in memory even when the disk is full.
   return m.persistLocked()
  })
 }()
 m.mu.Lock();e:=m.entries[id];contextErr:=ctx.Err();e.cancel();e.cancel,e.run=nil,nil;m.active[e.record.Queue]--;m.activeTotal--
 changed:=!Terminal(e.record.Status)
 if changed{
  e.record.Result=append(json.RawMessage(nil),result...)
  switch{case contextErr!=nil:e.record.Status,e.record.Error=Cancelled,"任务已取消";case err!=nil:e.record.Status,e.record.Error=Failed,err.Error();default:e.record.Status=Succeeded}
  touch(&e.record)
  if saveErr:=m.persistLocked();saveErr!=nil{e.record.Status,e.record.Error=Failed,"结果状态写入失败；请检查磁盘后按远端任务 ID 恢复，勿重复提交"}
 }
 r:=clone(e.record);m.startLocked();m.mu.Unlock();if changed{m.notify(r)}
}
func(m *Manager)Cancel(id string)error{
 m.mu.Lock();e:=m.entries[id];if e==nil||Terminal(e.record.Status){m.mu.Unlock();return nil}
 old:=clone(e.record);e.record.Status,e.record.Stage=Cancelled,"已停止本地处理；上游可能继续计费";touch(&e.record)
 if err:=m.persistLocked();err!=nil{e.record=old;m.mu.Unlock();return err}
 if e.cancel!=nil{e.cancel()}else{e.run=nil}
 r:=clone(e.record);m.startLocked();m.mu.Unlock();m.notify(r);return nil
}
func(m *Manager)Shutdown(ctx context.Context)error{
 m.mu.Lock();m.closed=true
 for _,e:=range m.entries{if !Terminal(e.record.Status){e.record.Status,e.record.Stage=Interrupted,"应用退出；任务等待手动恢复";touch(&e.record)};if e.cancel!=nil{e.cancel()}else{e.run=nil}}
 err:=m.persistLocked();m.mu.Unlock();done:=make(chan struct{});go func(){m.wg.Wait();close(done)}()
 select{case <-done:return err;case <-ctx.Done():return ctx.Err()}
}
